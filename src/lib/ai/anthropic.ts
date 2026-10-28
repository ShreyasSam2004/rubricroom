import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { aiFallbacksEnabled, aiModel, aiSpeed } from "@/lib/env";
import { AIOutputError, AIRefusalError, type StructuredRequest, type StructuredResult } from "./types";

const globalForClient = globalThis as unknown as { __rrAnthropic?: Anthropic; __rrFastOffUntil?: number };

function client() {
  if (!globalForClient.__rrAnthropic) {
    // Credentials resolve from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment.
    globalForClient.__rrAnthropic = new Anthropic({ maxRetries: 2, timeout: 240_000 });
  }
  return globalForClient.__rrAnthropic;
}

const FAST_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
const FAST_BETA = "fast-mode-2026-02-01";

/** Fast mode is tried first when enabled and supported, unless it recently failed for this process. */
export function fastModeFor(model: string, now = Date.now()) {
  return aiSpeed() === "fast" && FAST_MODELS.has(model) && now >= (globalForClient.__rrFastOffUntil ?? 0);
}

/**
 * Errors after which the same request is retried at standard speed: the fast pool is
 * rate-limited/overloaded, or fast mode is not enabled for this account (400/403 about speed).
 */
export function fastModeUnavailable(err: unknown): { retry: boolean; cooldownMs: number } {
  // InternalServerError covers 5xx including 529 "overloaded".
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) return { retry: true, cooldownMs: 60_000 };
  if ((err instanceof Anthropic.BadRequestError || err instanceof Anthropic.PermissionDeniedError) && /speed|fast/i.test(err.message)) return { retry: true, cooldownMs: 6 * 3_600_000 };
  return { retry: false, cooldownMs: 0 };
}

export async function anthropicStructured<S extends z.ZodType>(req: StructuredRequest<S>, model = aiModel()): Promise<StructuredResult<z.infer<S>>> {
  // Haiku has no server-side fallback model, so the parameter is only sent to models that do.
  const fallbacks = aiFallbacksEnabled() && !/haiku/i.test(model);
  const call = (fast: boolean) => {
    const body = {
      model,
      max_tokens: req.maxTokens ?? 16_000,
      // Stable per-agent system prompt first so repeated calls hit the prompt cache.
      system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: req.prompt }],
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? "medium" },
      ...(fallbacks || fast ? { betas: [...(fallbacks ? ["server-side-fallback-2026-07-01"] : []), ...(fast ? [FAST_BETA] : [])] } : {}),
      ...(fallbacks ? { fallbacks: "default" as const } : {}),
      ...(fast ? { speed: "fast" as const } : {}),
    };
    // A busy fast pool should fall back to standard speed at once, not back off and retry.
    const opts = fast ? { maxRetries: 0 } : undefined;
    if (!req.onText) return client().beta.messages.parse(body, opts);
    const stream = client().beta.messages.stream(body, opts);
    stream.on("text", (_delta, soFar) => {
      try {
        req.onText?.(soFar);
      } catch {
        /* a display callback must never break the call */
      }
    });
    return stream.finalMessage();
  };

  let response;
  if (fastModeFor(model)) {
    try {
      response = await call(true);
    } catch (err) {
      const { retry, cooldownMs } = fastModeUnavailable(err);
      if (!retry) throw err;
      globalForClient.__rrFastOffUntil = Date.now() + cooldownMs;
      response = await call(false);
    }
  } else {
    response = await call(false);
  }

  if (response.stop_reason === "refusal") {
    throw new AIRefusalError(response.stop_details?.explanation ?? "The model declined this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AIOutputError("The model ran out of output tokens before finishing.");
  }
  if (!response.parsed_output) {
    throw new AIOutputError("The model response did not match the expected structure.");
  }
  return {
    data: response.parsed_output as z.infer<S>,
    provider: "anthropic",
    model: response.model ?? model,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

export function isAnthropicRateLimit(err: unknown) {
  return err instanceof Anthropic.RateLimitError;
}

export function describeAnthropicError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The Anthropic API key lacks permission for this model.";
  if (err instanceof Anthropic.NotFoundError) return "The configured Claude model was not found.";
  if (err instanceof Anthropic.RateLimitError) return "The AI provider is rate-limiting requests right now.";
  if (err instanceof Anthropic.BadRequestError) return `The AI provider rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI provider.";
  if (err instanceof Anthropic.APIError) return `AI provider error (${err.status ?? "unknown"}).`;
  return null;
}
