import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { AINotConfiguredError, AIOutputError, AIRefusalError, RateLimitedError } from "@/lib/ai/types";
import { limits } from "@/lib/env";
import { UnsafeUrlError } from "@/lib/net/safe-url";
import { consume } from "@/lib/rate-limit";
import { clientIp, NoWorkspaceError, requireWorkspace } from "@/lib/workspace";

export const MAX_JSON_BYTES = 1_000_000;

type Params = Record<string, string>;

interface HandlerCtx<T> {
  workspaceId: string;
  body: T;
  req: Request;
  params: Params;
}

interface Options {
  /** "mutation" applies the per-IP daily limit; "job" also applies the per-workspace research-job limit. */
  limit?: "read" | "mutation" | "job";
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiHandler<S extends ZodType | null>(
  schema: S,
  fn: (ctx: HandlerCtx<S extends ZodType ? z.infer<S> : null>) => Promise<unknown>,
  opts: Options = {},
) {
  return async (req: Request, routeCtx: { params: Promise<Params> }) => {
    try {
      const ws = await requireWorkspace();
      const params = (await routeCtx?.params) ?? {};
      const limit = opts.limit ?? (req.method === "GET" ? "read" : "mutation");
      if (limit !== "read") {
        const ip = await clientIp();
        const r = await consume(`ip:${ip}`, limits.ipPerDay(), 86_400);
        if (!r.allowed) throw new RateLimitedError("Daily request limit reached for this network. Please try again tomorrow.", r.retryAfterSec);
      }
      if (limit === "job") {
        const r = await consume(`jobs:${ws.id}`, limits.jobsPerHour(), 3600);
        if (!r.allowed) throw new RateLimitedError(`Research limit reached (${limits.jobsPerHour()} research runs per hour). Try again in ${Math.ceil(r.retryAfterSec / 60)} min.`, r.retryAfterSec);
      }
      let body: unknown = null;
      if (schema) {
        const len = Number(req.headers.get("content-length") ?? 0);
        if (len > MAX_JSON_BYTES) throw new HttpError(413, "Request body is too large.");
        const text = await req.text();
        if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "Request body is too large.");
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw new HttpError(400, "Body must be JSON.");
        }
        const parsed = (schema as ZodType).safeParse(json);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw new HttpError(400, `Invalid input${first ? `: ${first.path.join(".") || "body"} — ${first.message}` : ""}.`);
        }
        body = parsed.data;
      }
      const result = await fn({ workspaceId: ws.id, body: body as never, req, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof NoWorkspaceError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof RateLimitedError) return NextResponse.json({ error: err.message }, { status: 429, headers: { "retry-after": String(err.retryAfterSec) } });
  if (err instanceof UnsafeUrlError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof AINotConfiguredError) return NextResponse.json({ error: err.message, code: "ai_not_configured" }, { status: 409 });
  if (err instanceof AIRefusalError) return NextResponse.json({ error: `The AI provider declined this request: ${err.message}` }, { status: 422 });
  if (err instanceof AIOutputError) return NextResponse.json({ error: err.message }, { status: 502 });
  const message = (err as Error)?.message ?? "Unexpected error";
  if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
  console.error("[api]", err);
  return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Something went wrong. Please try again." : message }, { status: 500 });
}

/** The message a failed request shows, as `errorResponse` would put it. */
export function errorMessage(err: unknown) {
  if (err instanceof HttpError || err instanceof RateLimitedError || err instanceof UnsafeUrlError || err instanceof AINotConfiguredError || err instanceof AIOutputError) return err.message;
  if (err instanceof AIRefusalError) return `The AI provider declined this request: ${err.message}`;
  const message = (err as Error)?.message ?? "Unexpected error";
  if (/not found|still being scored/i.test(message)) return message;
  console.error("[api]", err);
  return process.env.NODE_ENV === "production" ? "Something went wrong. Please try again." : message;
}

/**
 * Stream newline-delimited JSON events while `run` works. A failure becomes a final
 * `{ type: "error" }` event (the status line is already sent). If the visitor leaves, the work
 * still finishes and is saved; only the events stop.
 */
export function ndjsonStream<E extends object>(run: (emit: (event: E) => void) => Promise<object | void>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the client went away
        }
      };
      try {
        const done = await run(send);
        send({ type: "done", ...(done ?? {}) });
      } catch (err) {
        send({ type: "error", error: errorMessage(err) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}

// Shared input schemas with size limits.
export const zId = z.string().min(3).max(64).regex(/^[a-z]+_[a-f0-9]{8,32}$/);
export const zUrl = z.string().trim().max(2048);
export const zText = (max: number) => z.string().max(max);
