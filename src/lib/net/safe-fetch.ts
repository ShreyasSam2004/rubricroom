import dns from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { assertSafeUrl, isPublicAddress, UnsafeUrlError } from "./safe-url";

// Standard crawler UA format (like Googlebot's): honest bot identification that CDNs accept.
export const USER_AGENT = "Mozilla/5.0 (compatible; RubricRoomResearchBot/0.1; hackathon research assistant, fetches single public pages on user request)";

export type SafeFetchErrorCode =
  | "unsafe_url"
  | "blocked_address"
  | "timeout"
  | "too_large"
  | "bad_content_type"
  | "http_error"
  | "network"
  | "too_many_redirects"
  | "robots_disallowed";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses to hand non-public addresses to the socket — checked on every connection. */
export function guardedLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = (addresses as unknown as LookupAddress[]) ?? [];
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (list.length === 0 || blocked) {
      const e = new Error(`Resolved address ${blocked?.address ?? "(none)"} for ${hostname} is not public`) as NodeJS.ErrnoException;
      e.code = "ERR_BLOCKED_ADDRESS";
      return callback(e, "");
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const globalAgent = globalThis as unknown as { __rrAgent?: Agent };
function agent() {
  if (!globalAgent.__rrAgent) {
    globalAgent.__rrAgent = new Agent({
      connect: { lookup: guardedLookup as never, timeout: 8_000 },
      connections: 16,
      headersTimeout: 12_000,
      bodyTimeout: 15_000,
    });
  }
  return globalAgent.__rrAgent;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  accept?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedTypes?: string[]; // content-type prefixes
  /** For tests: inject a fetch implementation. Production uses undici with the guarded agent. */
  fetchImpl?: (url: string, init: Record<string, unknown>) => Promise<Response>;
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
  redirects: string[];
  headers: Headers;
}

export const HTML_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown"];
export const PDF_TYPES = ["application/pdf"];
export const JSON_TYPES = ["application/json", "application/vnd.github"];

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    method = "GET",
    // A plain "*/*": browser-style Accept lists from a non-browser client get blocked by some CDNs,
    // and content types are enforced after the response anyway (allowedTypes).
    accept = "*/*",
    maxBytes = 3_000_000,
    timeoutMs = 12_000,
    maxRedirects = 5,
    allowedTypes = [...HTML_TYPES, ...PDF_TYPES],
  } = opts;

  const redirects: string[] = [];
  let current: URL;
  try {
    current = assertSafeUrl(rawUrl);
  } catch (e) {
    throw new SafeFetchError("unsafe_url", (e as Error).message);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      const init = {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "en;q=0.9,hi;q=0.6", ...opts.headers },
        dispatcher: opts.fetchImpl ? undefined : agent(),
      };
      let res: Response;
      try {
        res = opts.fetchImpl
          ? await opts.fetchImpl(current.toString(), init)
          : ((await undiciFetch(current.toString(), init as never)) as unknown as Response);
      } catch (e) {
        throw classifyNetworkError(e);
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects.`);
        const next = new URL(res.headers.get("location")!, current);
        try {
          current = assertSafeUrl(next.toString()); // revalidate every hop
        } catch (e) {
          throw new SafeFetchError("unsafe_url", `Redirect blocked: ${(e as UnsafeUrlError).message}`);
        }
        redirects.push(current.toString());
        await res.body?.cancel().catch(() => undefined);
        continue;
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new SafeFetchError("http_error", `The page responded with HTTP ${res.status}.`, res.status);
      }
      if (method === "GET" && contentType && !allowedTypes.some((t) => contentType.startsWith(t))) {
        await res.body?.cancel().catch(() => undefined);
        throw new SafeFetchError("bad_content_type", `Unsupported content type: ${contentType.split(";")[0]}.`, res.status);
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      const isPdf = contentType.startsWith("application/pdf");
      if (isPdf && declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new SafeFetchError("too_large", `Document is larger than ${Math.round(maxBytes / 1e6)} MB.`, res.status);
      }
      const { body, truncated } = method === "HEAD" ? { body: Buffer.alloc(0), truncated: false } : await readCapped(res, maxBytes);
      if (truncated && isPdf) throw new SafeFetchError("too_large", `Document is larger than ${Math.round(maxBytes / 1e6)} MB.`);
      return {
        requestedUrl: rawUrl,
        finalUrl: current.toString(),
        status: res.status,
        contentType,
        body,
        truncated,
        redirects,
        headers: res.headers,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number) {
  if (!res.body) return { body: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks), truncated };
}

function classifyNetworkError(e: unknown): SafeFetchError {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? err.code;
  if (code === "ERR_BLOCKED_ADDRESS") {
    return new SafeFetchError("blocked_address", "The host resolved to a private or reserved address and was blocked.");
  }
  if (err.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return new SafeFetchError("timeout", "The page took too long to respond.");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new SafeFetchError("network", "The host could not be resolved.");
  return new SafeFetchError("network", `Network error: ${err.cause?.message ?? err.message ?? "unknown"}`);
}

// ---- robots.txt (best-effort politeness for page fetches; API endpoints skip this) ----

const robotsCache = new Map<string, { rules: string[]; at: number }>();

export function parseRobots(txt: string): string[] {
  const disallow: string[] = [];
  let applies = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*" || /rubricroom/i.test(value);
    else if (applies && key === "disallow" && value) disallow.push(value);
  }
  return disallow;
}

export async function robotsAllows(rawUrl: string, fetchImpl?: SafeFetchOptions["fetchImpl"]): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  const key = u.origin;
  let entry = robotsCache.get(key);
  if (!entry || Date.now() - entry.at > 3_600_000) {
    let rules: string[] = [];
    try {
      const res = await safeFetch(`${u.origin}/robots.txt`, {
        accept: "text/plain",
        // Many sites answer /robots.txt with an HTML 404 page; only a real text/plain file declares rules.
        allowedTypes: ["text/plain"],
        maxBytes: 200_000,
        timeoutMs: 5_000,
        fetchImpl,
      });
      rules = parseRobots(res.body.toString("utf8"));
    } catch {
      rules = []; // no robots.txt (or unreachable) → no restrictions declared
    }
    entry = { rules, at: Date.now() };
    robotsCache.set(key, entry);
  }
  const path = u.pathname + u.search;
  return !entry.rules.some((rule) => rule === "/" || path.startsWith(rule.replace(/\*.*$/, "")));
}
