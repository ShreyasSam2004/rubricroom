"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/** JSON fetch against our own API with readable errors. */
export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const j = json as { error?: string; code?: string } | null;
    throw new ApiError(j?.error ?? `Request failed (${res.status})`, res.status, j?.code);
  }
  return json as T;
}

/**
 * POST to an endpoint that streams newline-delimited JSON events, calling `onEvent` for each one
 * as it arrives. Resolves with the final "done" event; an "error" event rejects.
 */
export async function streamApi<E extends { type: string }>(path: string, body: unknown, onEvent: (event: E) => void): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(j?.error ?? `Request failed (${res.status})`, res.status, j?.code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done: Record<string, unknown> | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as E & { error?: string };
    if (event.type === "error") throw new ApiError(event.error ?? "Something went wrong.", 500);
    if (event.type === "done") done = event;
    else onEvent(event);
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  handle(buf);
  if (!done) throw new ApiError("The connection closed before the reply finished. Refresh to see what was saved.", 502);
  return done;
}

export async function uploadFile(file: File, kind?: "pdf" | "image") {
  const form = new FormData();
  form.append("file", file);
  if (kind) form.append("kind", kind);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? "Upload failed", res.status);
  return json.upload as { id: string; filename: string; contentType: string; size: number };
}

export function download(path: string) {
  const a = document.createElement("a");
  a.href = path;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
