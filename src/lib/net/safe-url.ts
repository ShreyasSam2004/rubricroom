import ipaddr from "ipaddr.js";

export type UrlRejection =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_in_url"
  | "blocked_port"
  | "blocked_host"
  | "blocked_address"
  | "too_long";

export class UnsafeUrlError extends Error {
  constructor(
    public readonly reason: UrlRejection,
    message: string,
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** True only for globally routable unicast addresses (no loopback, private, link-local, CGNAT, metadata, etc.). */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) parsed = v6.toIPv4Address();
  }
  return parsed.range() === "unicast";
}

function stripBrackets(host: string) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Static validation of a user-supplied URL. DNS resolution is checked separately at connect time
 * (see safe-fetch.ts) so that DNS rebinding and redirects into private networks are also blocked.
 */
export function assertSafeUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0) throw new UnsafeUrlError("invalid_url", "URL is empty.");
  if (raw.length > 2048) throw new UnsafeUrlError("too_long", "URL is longer than 2048 characters.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("invalid_url", "That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("unsupported_protocol", `Only http and https URLs are allowed (got ${url.protocol}).`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("credentials_in_url", "URLs containing credentials are not allowed.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError("blocked_port", `Port ${url.port} is not allowed; only standard web ports are fetched.`);
  }
  const host = stripBrackets(url.hostname.toLowerCase()).replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("invalid_url", "URL has no host.");
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) {
      throw new UnsafeUrlError("blocked_address", "URLs pointing at private, loopback or link-local addresses are blocked.");
    }
    return url;
  }
  // Numeric-looking hosts that ipaddr rejects (e.g. "2130706433", "0x7f.1") are resolved by some stacks as IPs.
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+/i.test(host)) {
    throw new UnsafeUrlError("blocked_address", "Ambiguous numeric hosts are blocked.");
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("blocked_host", `Host ${host} is an internal name and is blocked.`);
  }
  if (!host.includes(".")) {
    throw new UnsafeUrlError("blocked_host", "Single-label hostnames are blocked.");
  }
  return url;
}

export function isSafeUrl(raw: string): boolean {
  try {
    assertSafeUrl(raw);
    return true;
  } catch {
    return false;
  }
}
