// Forge — Technical Feasibility Specialist. Reviews scope, integrations and demo reliability.
// Time estimates are ranges with stated assumptions; no model can know exact development time.

import { z } from "zod";
import { generateStructured, isAIConfigured } from "@/lib/ai";
import { clamp } from "@/lib/text";
import type { BuilderProfileData, FeasibilityReview, IdeaFields } from "@/lib/types";

export const ForgeSchema = z.object({
  complexity: z.object({ rating: z.number().int(), rationale: z.string() }),
  integrations: z.array(z.object({ name: z.string(), difficulty: z.enum(["low", "medium", "high"]), notes: z.string() })),
  externalDependencies: z.array(z.string()),
  testing: z.string(),
  deployment: z.string(),
  demoReliability: z.object({ rating: z.number().int(), rationale: z.string() }),
  deadlineRisks: z.array(z.string()),
  mvp: z.array(z.string()).describe("The smallest complete set of features that proves the concept."),
  cut: z.array(z.string()).describe("Features to cut or defer."),
  estimateHours: z.object({ low: z.number(), high: z.number() }),
  assumptions: z.array(z.string()),
});

const INTEGRATIONS: { re: RegExp; name: string; difficulty: "low" | "medium" | "high"; notes: string }[] = [
  { re: /video call|webrtc|real[- ]?time video/i, name: "Real-time video", difficulty: "high", notes: "Signalling, TURN servers and browser permissions make live demos fragile." },
  { re: /\b(ios|android|mobile app|react native|flutter)\b/i, name: "Native mobile app", difficulty: "high", notes: "Store review / device setup; a responsive web app is usually enough for judges." },
  { re: /payment|stripe|razorpay|upi/i, name: "Payments", difficulty: "medium", notes: "Use test mode; never take real payments in a demo." },
  { re: /\b(auth|login|sign[- ]?in|oauth)\b/i, name: "Authentication", difficulty: "medium", notes: "Judges must be able to try it without signing up — provide a demo path." },
  { re: /\b(llm|gpt|claude|gemini|ai agent|agents?)\b/i, name: "LLM API", difficulty: "medium", notes: "Latency, cost and rate limits; cache demo results and add usage limits." },
  { re: /\b(scrap|crawl)/i, name: "Web scraping", difficulty: "medium", notes: "Sites block or change; respect robots.txt and handle failures visibly." },
  { re: /\b(voice|speech|dictat|transcri|wispr)\b/i, name: "Voice input", difficulty: "low", notes: "Wispr Flow inserts text into any field, so a well-designed text area is enough — no audio pipeline needed." },
  { re: /coding test|code execution|sandbox/i, name: "Code execution sandbox", difficulty: "high", notes: "Running untrusted code safely needs isolation (e.g. a hosted sandbox API)." },
  { re: /\b(whatsapp|telegram|slack|discord)\b/i, name: "Messaging platform bot", difficulty: "medium", notes: "Webhook setup and platform approval can take time." },
  { re: /\b(blockchain|web3|smart contract)\b/i, name: "Blockchain", difficulty: "high", notes: "Testnets, wallets and gas add demo friction." },
  { re: /\b(train|fine[- ]?tun)\w* (a |our )?model/i, name: "Model training", difficulty: "high", notes: "Training rarely fits a hackathon; use a hosted model." },
];

export function heuristicFeasibility(idea: IdeaFields, profile: BuilderProfileData | null, hoursAvailable: number | null): FeasibilityReview {
  const text = `${idea.summary} ${idea.workflow} ${idea.features.join(" ")} ${idea.techStack.join(" ")}`;
  const integrations = INTEGRATIONS.filter((i) => i.re.test(text)).map(({ name, difficulty, notes }) => ({ name, difficulty, notes }));
  const high = integrations.filter((i) => i.difficulty === "high").length;
  const n = Math.max(1, idea.features.length);
  const experience = profile?.experienceLevel ?? "intermediate";
  const perFeature = experience === "advanced" ? 3 : experience === "beginner" ? 7 : 4.5;
  const low = Math.round(n * perFeature * 0.7 + high * 4 + 4);
  const highEst = Math.round(n * perFeature * 1.6 + high * 10 + 8);
  const complexity = clamp(1 + Math.floor(n / 3) + high, 1, 5);
  const deadlineRisks: string[] = [];
  if (hoursAvailable !== null && highEst > hoursAvailable) deadlineRisks.push(`Upper estimate (${highEst}h) exceeds the ~${Math.round(hoursAvailable)}h available before the deadline.`);
  if (high) deadlineRisks.push(`${high} high-difficulty integration(s) could consume most of the build time.`);
  if (n > 6) deadlineRisks.push(`${n} features is a large scope; judges reward one flow that works over many that half-work.`);
  const ordered = [...idea.features];
  const mvpCount = Math.max(1, Math.min(3, Math.ceil(n / 2)));
  return {
    complexity: { rating: complexity, rationale: `${n} feature(s), ${integrations.length} notable integration(s) (${high} high difficulty).` },
    integrations,
    externalDependencies: integrations.map((i) => i.name),
    testing: "Write unit tests for the core transformation and one end-to-end test of the main flow.",
    deployment: "Deploy the web app early (day 1) so the public link is always working.",
    demoReliability: { rating: clamp(5 - high - (n > 6 ? 1 : 0), 1, 5), rationale: high ? "Fragile live integrations; record a backup video and cache demo data." : "No obviously fragile live integrations." },
    deadlineRisks,
    mvp: ordered.slice(0, mvpCount),
    cut: ordered.filter((f) => INTEGRATIONS.some((i) => i.difficulty === "high" && i.re.test(f))),
    estimateHours: { low, high: highEst },
    assumptions: [
      `Assumes ${experience} experience and roughly ${perFeature}h per feature — a rough range, not a prediction.`,
      "Estimates exclude time for recording the demo and writing the submission.",
    ],
    method: "heuristic",
    createdAt: new Date().toISOString(),
  };
}

export async function forgeReview(
  workspaceId: string,
  idea: IdeaFields,
  profile: BuilderProfileData | null,
  hoursAvailable: number | null,
  requiredTech: string[],
): Promise<FeasibilityReview> {
  if (!isAIConfigured()) return heuristicFeasibility(idea, profile, hoursAvailable);
  let data: z.infer<typeof ForgeSchema>;
  try {
    ({ data } = await generateStructured({
    agent: "forge",
    workspaceId,
    schemaName: "forge_feasibility",
    schema: ForgeSchema,
    effort: "low",
    maxTokens: 5000,
    system: `You are Forge, the technical-feasibility agent in RubricRoom. Review a hackathon idea's architecture, integrations, scope and demo reliability. Be concrete and skeptical about scope. Give time estimates as ranges with explicit assumptions; never claim to know exact development time. Ratings: complexity 1 (trivial) to 5 (very hard); demoReliability 1 (fragile) to 5 (very reliable). Only describe official APIs you are confident exist; otherwise say "verify the official API".`,
    prompt: `Idea:\n${JSON.stringify(idea, null, 1)}\n\nRequired sponsor technology: ${requiredTech.join(", ") || "none"}\nBuilder: ${profile ? `${profile.mode}, ${profile.experienceLevel}, ${profile.hoursPerDay}h/day, ${[...profile.languages, ...profile.frameworks].join(", ")}` : "unknown"}\nHours available before deadline (approx): ${hoursAvailable ?? "unknown"}`,
  }));
  } catch {
    return heuristicFeasibility(idea, profile, hoursAvailable); // model unavailable or the AI budget is used up
  }
  return {
    ...data,
    complexity: { ...data.complexity, rating: clamp(data.complexity.rating, 1, 5) },
    demoReliability: { ...data.demoReliability, rating: clamp(data.demoReliability.rating, 1, 5) },
    method: "ai",
    createdAt: new Date().toISOString(),
  };
}
