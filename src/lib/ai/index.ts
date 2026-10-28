import type { z } from "zod";
import { getDb } from "@/lib/db/client";
import { aiCalls } from "@/lib/db/schema";
import { aiBudget, aiFastModel, aiModel, aiProvider, limits } from "@/lib/env";
import { consume, peek } from "@/lib/rate-limit";
import { newId } from "@/lib/text";
import { clientIp } from "@/lib/workspace";
import { AINotConfiguredError, RateLimitedError, type StructuredRequest, type StructuredResult } from "./types";

export * from "./types";
export { UNTRUSTED_POLICY, wrapUntrusted, looksLikeInjection } from "./untrusted";
export { countKey, partialString } from "./partial";

export function isAIConfigured() {
  return aiProvider() !== "none";
}

const DAY = 86_400;
// Spend is counted in micro-dollars so the integer counter stays exact.
const SPEND_SCOPE = "ai-spend:global";

async function visitorIp(): Promise<string | null> {
  try {
    return await clientIp();
  } catch {
    return null; // outside a request (scripts, tests): the workspace and daily caps still apply
  }
}

/**
 * Run one structured agent call: enforce the shared daily spending cap and the per-visitor and
 * per-workspace AI budgets, call the configured provider, and write an audit row (success or
 * failure) so every AI-visible action is traceable. Callers fall back to their rule-based agent
 * when a cap is hit.
 */
export async function generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const provider = aiProvider();
  if (provider === "none") throw new AINotConfiguredError();

  const spent = await peek(SPEND_SCOPE, DAY);
  if (spent >= aiBudget.dailyUsd() * 1_000_000) {
    const resetSec = DAY - (Math.floor(Date.now() / 1000) % DAY);
    throw new RateLimitedError(`Today's shared AI budget for this demo is used up, so the rule-based agents are answering. It resets in ${Math.ceil(resetSec / 3600)} h (00:00 UTC).`, resetSec);
  }

  const ip = await visitorIp();
  if (ip) {
    const ok = await consume(`ai-ip:${ip}`, limits.aiPerIpHour(), 3600);
    if (!ok.allowed) {
      throw new RateLimitedError(`This network has used its AI allowance for the hour (${limits.aiPerIpHour()} agent calls). Try again in ${Math.ceil(ok.retryAfterSec / 60)} min.`, ok.retryAfterSec);
    }
  }

  if (req.workspaceId) {
    const ok = await consume(`ai:${req.workspaceId}`, limits.aiPerHour(), 3600);
    if (!ok.allowed) {
      throw new RateLimitedError(
        `This workspace has used its AI budget for the hour (${limits.aiPerHour()} agent calls). Try again in ${Math.ceil(ok.retryAfterSec / 60)} min.`,
        ok.retryAfterSec,
      );
    }
  }

  const fast = req.tier === "fast";
  const model = fast ? aiFastModel() : aiModel();
  const started = Date.now();
  try {
    const result =
      provider === "anthropic"
        ? await (await import("./anthropic")).anthropicStructured(req, model)
        : await (await import("./openai")).openaiStructured(req, model);
    await audit(req, provider, result.model, "ok", Date.now() - started, result.usage);
    const price = fast ? aiBudget.fastPerM() : { input: aiBudget.inputPerM(), output: aiBudget.outputPerM() };
    const cost = Math.ceil(result.usage.input * price.input + result.usage.output * price.output);
    if (cost > 0) await consume(SPEND_SCOPE, Number.MAX_SAFE_INTEGER, DAY, cost).catch(() => undefined);
    return result;
  } catch (err) {
    await audit(req, provider, model, "error", Date.now() - started, undefined, err);
    throw err;
  }
}

async function audit(
  req: StructuredRequest<z.ZodType>,
  provider: string,
  model: string,
  status: string,
  durationMs: number,
  usage?: { input: number; output: number },
  err?: unknown,
) {
  try {
    const db = await getDb();
    await db.insert(aiCalls).values({
      id: newId("ai"),
      workspaceId: req.workspaceId ?? null,
      agent: req.agent,
      provider,
      model,
      inputTokens: usage?.input ?? null,
      outputTokens: usage?.output ?? null,
      status,
      error: err ? String((err as Error).message ?? err).slice(0, 500) : null,
      durationMs,
    });
  } catch {
    /* auditing must never break the user action */
  }
}

export async function describeAIError(err: unknown): Promise<string> {
  if (err instanceof AINotConfiguredError || err instanceof RateLimitedError) return err.message;
  if (aiProvider() === "anthropic") {
    const { describeAnthropicError } = await import("./anthropic");
    const d = describeAnthropicError(err);
    if (d) return d;
  }
  return (err as Error)?.message ?? "Unknown AI error";
}
