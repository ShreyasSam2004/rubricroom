// Nova — Opportunity Explorer. Proposes differentiated directions grounded in retrieved signals.
// Problems are only labelled "observed" when a retrieved signal supports them; references must be
// URLs that research actually retrieved — anything else is dropped in code.

import { z } from "zod";
import { generateStructured, isAIConfigured, UNTRUSTED_POLICY, wrapUntrusted } from "@/lib/ai";
import { isDuplicateConcept } from "@/lib/research/similarity";
import { canonicalUrl, truncate } from "@/lib/text";
import type { BuilderProfileData, OpportunityCard, ProjectFingerprint } from "@/lib/types";

export const DISCOVERY_MODES = {
  unsolved: { label: "Unsolved problems", description: "Practical problems people repeatedly describe in public." },
  overcrowded: { label: "Overcrowded areas", description: "Categories with many existing builds — and how to avoid them." },
  underserved: { label: "Underserved users", description: "Groups that get little attention from typical hackathon projects." },
  sponsor: { label: "Sponsor opportunity", description: "What the sponsor technology uniquely enables, and what authentic use looks like." },
  combinations: { label: "Unexpected combinations", description: "Coherent new concepts from neglected problems × capabilities." },
  alternative: { label: "Alternative to my idea", description: "Substantially different directions than an idea you already have." },
} as const;
export type DiscoveryMode = keyof typeof DISCOVERY_MODES;

export const MODIFIERS = {
  more: "Generate more",
  ambitious: "More technically ambitious",
  impact: "More human impact",
  less_crowded: "Less crowded",
  easier: "Easier to build",
  sponsor: "Better sponsor integration",
  visual: "More visual demo",
  commercial: "More commercially viable",
} as const;
export type Modifier = keyof typeof MODIFIERS;

export interface Signal {
  kind: "pain_point" | "crowded" | "competitor" | "sponsor" | "official";
  label: string;
  url?: string;
  detail?: string;
}

export interface NovaInput {
  workspaceId: string;
  hackathon: { name: string; summary: string; whatToBuild: string; criteria: { name: string; weight: number | null }[]; sponsors: string[]; mandatory: string[] } | null;
  profile: BuilderProfileData | null;
  hoursAvailable: number | null;
  mode: DiscoveryMode;
  modifiers: Modifier[];
  request: string | null;
  baseIdea: { name: string; summary: string } | null;
  signals: Signal[];
  avoid: { name: string; fingerprint: ProjectFingerprint }[];
  count: number;
}

const FpSchema = z.object({
  targetUser: z.string(),
  problem: z.string(),
  workflow: z.string(),
  input: z.string(),
  transformation: z.string(),
  output: z.string(),
  technology: z.string(),
  delivery: z.string(),
  keywords: z.array(z.string()),
});

export const CardsSchema = z.object({
  cards: z.array(
    z.object({
      name: z.string(),
      pitch: z.string(),
      targetUser: z.string(),
      problem: z.string(),
      problemEvidence: z.array(z.object({ signalIndex: z.number().int().nullable(), label: z.string() })).describe("signalIndex refers to the numbered SIGNALS; null means it is an unverified assumption."),
      howItWorks: z.string(),
      demoMoment: z.string().describe("The single memorable interaction a judge would see."),
      differentiation: z.string().describe("Why this differs from the known projects listed, specifically."),
      sponsorIntegration: z.string().describe("Authentic use of the sponsor technology, or how a fake integration would look and be avoided."),
      components: z.array(z.string()),
      mvpScope: z.array(z.string()),
      risks: z.array(z.string()),
      feasibility: z.enum(["low", "medium", "high"]),
      referenceSignalIndexes: z.array(z.number().int()),
      assumptions: z.array(z.string()),
      fingerprint: FpSchema,
    }),
  ),
});

export function signalsBlock(signals: Signal[]) {
  return signals.map((s, i) => `[${i}] (${s.kind}) ${s.label}${s.url ? ` — ${s.url}` : ""}${s.detail ? `\n    ${truncate(s.detail, 300)}` : ""}`).join("\n");
}

export async function novaGenerate(input: NovaInput): Promise<{ cards: OpportunityCard[]; removed: { name: string; duplicateOf: string }[] }> {
  if (!isAIConfigured()) throw new Error("Opportunity generation needs an AI provider. Research signals were still collected and are shown below.");
  const modifierText = input.modifiers.map((m) => MODIFIERS[m]).join("; ");
  const { data } = await generateStructured({
    agent: "nova",
    workspaceId: input.workspaceId,
    schemaName: "nova_opportunities",
    schema: CardsSchema,
    effort: "medium",
    maxTokens: 16_000,
    system: `You are Nova, the opportunity-exploration agent in RubricRoom. You propose hackathon project directions that are genuinely different from each other and from known projects — varied domains, users and workflows, not ten chatbots.
Rules:
- Ground problems in the numbered SIGNALS where possible. If a problem is not supported by a signal, mark that evidence with signalIndex null and list it under assumptions. Never invent research, statistics, users or URLs.
- Never claim an underserved group "needs" the product; frame it as a hypothesis to validate.
- Combinations must solve one coherent problem; don't stack unrelated technologies.
- Respect the builder's skills and time. Sponsor integration must be load-bearing and possible with the sponsor's real capabilities. For Wispr Flow: it inserts dictated, formatted text into any text field — there is no public transcription API to call.
- Each card's fingerprint must describe its concept structure honestly.
${UNTRUSTED_POLICY}`,
    prompt: `${input.hackathon ? `HACKATHON: ${input.hackathon.name}\n${input.hackathon.summary}\nWhat to build: ${input.hackathon.whatToBuild}\nRubric: ${input.hackathon.criteria.map((c) => `${c.name} (${c.weight ?? "?"}%)`).join("; ")}\nSponsors: ${input.hackathon.sponsors.join(", ")}\nMandatory: ${input.hackathon.mandatory.join(" | ")}` : "No hackathon selected."}

BUILDER: ${input.profile ? JSON.stringify(input.profile) : "unknown"}; hours available ≈ ${input.hoursAvailable ?? "unknown"}

MODE: ${DISCOVERY_MODES[input.mode].label} — ${DISCOVERY_MODES[input.mode].description}
${modifierText ? `MODIFIERS: ${modifierText}` : ""}
${input.request ? `PARTICIPANT REQUEST (dictated): ${wrapUntrusted({ kind: "request" }, input.request, 1500)}` : ""}
${input.baseIdea ? `CURRENT IDEA (propose substantially different alternatives, not renames): ${input.baseIdea.name} — ${input.baseIdea.summary}` : ""}

KNOWN PROJECTS / IDEAS TO AVOID DUPLICATING:
${input.avoid.map((a) => `- ${a.name}: ${a.fingerprint.problem} | ${a.fingerprint.targetUser} | ${a.fingerprint.workflow}`).join("\n") || "- none"}

SIGNALS (retrieved by RubricRoom):
${wrapUntrusted({ kind: "research_signals" }, signalsBlock(input.signals), 20_000)}

Generate ${input.count} opportunity cards.`,
  });

  return diversify(groundCards(data.cards, input.signals, input.mode), input.avoid);
}

export type RawCard = z.infer<typeof CardsSchema>["cards"][number];

/**
 * Evidence discipline, enforced in code: a problem is "observed" only when it points at a real
 * retrieved signal of an evidential kind, and references can only be URLs research retrieved.
 * Anything else the model wrote is kept as an assumption, never as a citation.
 */
export function groundCards(raw: RawCard[], signals: Signal[], mode: string): OpportunityCard[] {
  const allowedUrls = new Set(signals.filter((s) => s.url).map((s) => canonicalUrl(s.url!)));
  return raw.map((c) => ({
    name: c.name,
    pitch: c.pitch,
    targetUser: c.targetUser,
    problem: c.problem,
    problemEvidence: c.problemEvidence.map((e) => {
      const s = e.signalIndex !== null && e.signalIndex >= 0 ? signals[e.signalIndex] : undefined;
      return s ? { label: e.label, url: s.url, observed: s.kind === "pain_point" || s.kind === "crowded" || s.kind === "official" } : { label: e.label, observed: false };
    }),
    howItWorks: c.howItWorks,
    demoMoment: c.demoMoment,
    differentiation: c.differentiation,
    sponsorIntegration: c.sponsorIntegration,
    components: c.components,
    mvpScope: c.mvpScope,
    risks: c.risks,
    feasibility: c.feasibility,
    references: c.referenceSignalIndexes
      .map((i) => signals[i])
      .filter((s): s is Signal & { url: string } => Boolean(s?.url) && allowedUrls.has(canonicalUrl(s!.url!)))
      .map((s) => ({ label: s.label, url: s.url })),
    assumptions: c.assumptions,
    fingerprint: c.fingerprint,
    mode,
  }));
}

/** Drop cards that repeat a known concept or each other under a different name. */
export function diversify(cards: OpportunityCard[], avoid: { name: string; fingerprint: ProjectFingerprint }[]) {
  const kept: OpportunityCard[] = [];
  const removed: { name: string; duplicateOf: string }[] = [];
  for (const card of cards) {
    const dupKnown = avoid.find((a) => isDuplicateConcept(card.fingerprint, a.fingerprint));
    const dupKept = kept.find((k) => isDuplicateConcept(card.fingerprint, k.fingerprint));
    const dup = dupKnown?.name ?? dupKept?.name;
    if (dup) removed.push({ name: card.name, duplicateOf: dup });
    else kept.push(card);
  }
  return { cards: kept, removed };
}

/** Category probes for the "overcrowded areas" mode — counted with GitHub search, which needs no key. */
export const CROWDED_PROBES = [
  "ai chatbot",
  "ai resume reviewer",
  "ai mock interview",
  "expense tracker",
  "ai study assistant",
  "ai meeting notes summarizer",
  "voice assistant",
  "hackathon idea generator",
];
