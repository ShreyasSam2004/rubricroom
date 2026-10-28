// Server-only configuration. Never import from client components.

export type AIProviderName = "anthropic" | "openai" | "none";
export type SearchProviderName = "tavily" | "exa" | "none";

function clean(v: string | undefined) {
  const t = v?.trim();
  return t ? t : undefined;
}

export function aiProvider(): AIProviderName {
  const pref = clean(process.env.AI_PROVIDER)?.toLowerCase() ?? "auto";
  const hasAnthropic = Boolean(clean(process.env.ANTHROPIC_API_KEY) || clean(process.env.ANTHROPIC_AUTH_TOKEN));
  const hasOpenAI = Boolean(clean(process.env.OPENAI_API_KEY));
  if (pref === "none") return "none";
  if (pref === "anthropic") return hasAnthropic ? "anthropic" : "none";
  if (pref === "openai") return hasOpenAI ? "openai" : "none";
  if (hasAnthropic) return "anthropic";
  if (hasOpenAI) return "openai";
  return "none";
}

export function aiModel(): string {
  if (aiProvider() === "openai") return clean(process.env.OPENAI_MODEL) ?? "gpt-5";
  return clean(process.env.AI_MODEL) ?? "claude-opus-5-5";
}

/** A quicker, cheaper model for short replies where waiting hurts most (the Judge's Room opening question). */
export function aiFastModel(): string {
  return clean(process.env.AI_FAST_MODEL) ?? (aiProvider() === "openai" ? "gpt-5-mini" : "claude-haiku-5-5");
}

export function aiFallbacksEnabled() {
  return (clean(process.env.AI_FALLBACKS) ?? "on").toLowerCase() !== "off";
}

/**
 * "fast" asks Claude for fast output (about 2x quicker on Opus, at 2x the token price). Only
 * models that support it get the flag; if the fast pool is busy or unavailable, the call quietly
 * retries at standard speed.
 */
export function aiSpeed(): "fast" | "standard" {
  return (clean(process.env.AI_SPEED) ?? "fast").toLowerCase() === "standard" ? "standard" : "fast";
}

export function searchProvider(): SearchProviderName {
  const pref = clean(process.env.SEARCH_PROVIDER)?.toLowerCase() ?? "auto";
  const tavily = Boolean(clean(process.env.TAVILY_API_KEY));
  const exa = Boolean(clean(process.env.EXA_API_KEY));
  if (pref === "none") return "none";
  if (pref === "tavily") return tavily ? "tavily" : "none";
  if (pref === "exa") return exa ? "exa" : "none";
  if (tavily) return "tavily";
  if (exa) return "exa";
  return "none";
}

export const keys = {
  tavily: () => clean(process.env.TAVILY_API_KEY),
  exa: () => clean(process.env.EXA_API_KEY),
  github: () => clean(process.env.GITHUB_TOKEN),
  openai: () => clean(process.env.OPENAI_API_KEY),
};

function num(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const limits = {
  aiPerHour: () => num("RATE_LIMIT_AI_PER_HOUR", 60),
  aiPerIpHour: () => num("RATE_LIMIT_AI_PER_IP_HOUR", 30),
  jobsPerHour: () => num("RATE_LIMIT_JOBS_PER_HOUR", 12),
  ipPerDay: () => num("RATE_LIMIT_IP_PER_DAY", 300),
};

/**
 * Shared daily AI spending cap for a public deployment, estimated from each call's token usage at
 * the model's list price (US$ per million tokens; override the price for other models).
 */
export const aiBudget = {
  dailyUsd: () => num("AI_DAILY_BUDGET_USD", 3),
  inputPerM: () => num("AI_PRICE_INPUT_PER_M", aiProvider() === "openai" ? 1.25 : aiSpeed() === "fast" ? 8 : 4),
  outputPerM: () => num("AI_PRICE_OUTPUT_PER_M", aiProvider() === "openai" ? 10 : aiSpeed() === "fast" ? 40 : 20),
  /** The quick model's list price; an unknown model is counted at the main model's price. */
  fastPerM: () => {
    const hit = FAST_PRICES.find(([re]) => re.test(aiFastModel()));
    return hit ? { input: hit[1], output: hit[2] } : { input: aiBudget.inputPerM(), output: aiBudget.outputPerM() };
  },
};

const FAST_PRICES: [RegExp, number, number][] = [
  [/^gpt-5-nano/i, 0.05, 0.4],
  [/^gpt-5-mini/i, 0.25, 2],
  [/^claude-haiku-5/i, 0.1, 0.5],
];

/** Per-job research budgets. Hitting one returns partial results with an explanation. */
export const researchBudget = {
  webQueries: 8,
  urlFetches: 14,
  githubRequests: 6,
  hnRequests: 4,
  aiCalls: 6,
  maxJobMs: 4 * 60 * 1000,
};

export function providerStatus() {
  return {
    ai: aiProvider(),
    model: aiProvider() === "none" ? null : aiModel(),
    fastModel: aiProvider() === "none" ? null : aiFastModel(),
    search: searchProvider(),
    github: keys.github() ? "token" : "unauthenticated",
    database: clean(process.env.DATABASE_URL) ? "postgres" : "pglite",
  } as const;
}
