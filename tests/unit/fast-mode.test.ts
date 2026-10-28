// Fast mode: requested only on models that support it, and any fast-pool problem quietly falls back
// to a standard-speed call instead of failing the user's action.

import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const g = globalThis as unknown as { __rrAnthropic?: unknown; __rrFastOffUntil?: number };
const parse = vi.fn();
const ok = { stop_reason: "end_turn", parsed_output: { ok: true }, model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 } };
const apiError = (message: string) => ({ type: "error", error: { type: "invalid_request_error", message } });
const req = { agent: "sprint" as const, schemaName: "t", schema: z.object({ ok: z.boolean() }), system: "s", prompt: "p" };

async function run() {
  const { anthropicStructured } = await import("@/lib/ai/anthropic");
  return anthropicStructured(req);
}

describe("Claude fast mode", () => {
  beforeEach(() => {
    parse.mockReset();
    g.__rrAnthropic = { beta: { messages: { parse } } };
    g.__rrFastOffUntil = 0;
    vi.stubEnv("AI_MODEL", "claude-opus-5-5");
    vi.stubEnv("AI_SPEED", "fast");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete g.__rrAnthropic;
  });

  it("asks for fast output on Opus 5.5 with the beta flag and no client retries", async () => {
    parse.mockResolvedValueOnce(ok);
    await run();
    const [body, opts] = parse.mock.calls[0];
    expect(body.speed).toBe("fast");
    expect(body.betas).toContain("fast-mode-2026-02-01");
    expect(body.betas).toContain("server-side-fallback-2026-07-01");
    expect(opts).toEqual({ maxRetries: 0 });
  });

  it("falls back to standard speed when the fast pool is rate-limited, then cools down", async () => {
    parse.mockRejectedValueOnce(new Anthropic.RateLimitError(429, {}, "rate limited", new Headers())).mockResolvedValueOnce(ok);
    const r = await run();
    expect(r.data).toEqual({ ok: true });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1][0].speed).toBeUndefined();
    expect(parse.mock.calls[1][0].betas).not.toContain("fast-mode-2026-02-01");

    parse.mockResolvedValueOnce(ok);
    await run(); // within the cooldown: straight to standard
    expect(parse.mock.calls[2][0].speed).toBeUndefined();
  });

  it("falls back when fast mode is not enabled for the account", async () => {
    parse.mockRejectedValueOnce(new Anthropic.BadRequestError(400, apiError("speed 'fast' is not available for this organization"), undefined, new Headers())).mockResolvedValueOnce(ok);
    await run();
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not retry real request errors at standard speed", async () => {
    parse.mockRejectedValueOnce(new Anthropic.BadRequestError(400, apiError("The compiled grammar is too large"), undefined, new Headers()));
    await expect(run()).rejects.toThrow(/grammar/);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("never sends speed for models without fast mode, or when AI_SPEED=standard", async () => {
    vi.stubEnv("AI_MODEL", "claude-haiku-5-5");
    parse.mockResolvedValue(ok);
    await run();
    expect(parse.mock.calls[0][0].speed).toBeUndefined();
    vi.stubEnv("AI_MODEL", "claude-opus-5-5");
    vi.stubEnv("AI_SPEED", "standard");
    await run();
    expect(parse.mock.calls[1][0].speed).toBeUndefined();
  });
});
