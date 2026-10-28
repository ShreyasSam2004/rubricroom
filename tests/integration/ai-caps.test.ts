// The public deployment's AI protection: a shared daily spending cap (estimated from token usage)
// and rule-based fallbacks when it is reached. The model is a mocked OpenAI endpoint.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetDbForTests } from "@/lib/db/client";
import { consume, peek } from "@/lib/rate-limit";

const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify({ model: "gpt-5", choices: [{ message: { content: JSON.stringify({ ok: "yes" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 }),
);

const req = { agent: "prism" as const, workspaceId: null, system: "s", prompt: "p", schema: z.object({ ok: z.string() }), schemaName: "caps_test", effort: "low" as const };

beforeAll(() => {
  Object.assign(process.env, { AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-5", AI_DAILY_BUDGET_USD: "1" });
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(async () => {
  await resetDbForTests();
  fetchMock.mockClear();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  Object.assign(process.env, { AI_PROVIDER: "none", OPENAI_API_KEY: "" });
  await resetDbForTests();
});

describe("shared AI spending cap", () => {
  it("records each call's estimated cost and maps effort to lighter GPT-5 reasoning", async () => {
    const { generateStructured } = await import("@/lib/ai");
    const out = await generateStructured(req);
    expect(out.data.ok).toBe("yes");
    // 1000 input tokens at $1.25/M + 500 output tokens at $10/M = $0.00625 = 6250 micro-dollars.
    expect(await peek("ai-spend:global", 86_400)).toBe(6250);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.reasoning_effort).toBe("minimal");
  });

  it("refuses calls once today's budget is spent, without contacting the provider", async () => {
    await consume("ai-spend:global", Number.MAX_SAFE_INTEGER, 86_400, 1_000_000); // $1 spent
    const { generateStructured, RateLimitedError } = await import("@/lib/ai");
    await expect(generateStructured(req)).rejects.toBeInstanceOf(RateLimitedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the rule-based agents when the cap is reached", async () => {
    await consume("ai-spend:global", Number.MAX_SAFE_INTEGER, 86_400, 1_000_000);
    const { structurePitch } = await import("@/lib/agents/prism");
    const s = await structurePitch("ws_x", "As a nurse, handovers at shift change take 30 minutes and details get lost.");
    expect(s.method).toBe("heuristic");
    expect(s.idea.targetAudience).toBe("Nurses");
    const { interpretCommand } = await import("@/lib/agents/commands");
    expect((await interpretCommand("ws_x", "do something unusual with my stuff")).intent).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
