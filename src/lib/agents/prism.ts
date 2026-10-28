// Prism — Product Strategist. Turns a spoken pitch into a structured idea, and compares ideas.

import { z } from "zod";
import { generateStructured, isAIConfigured, wrapUntrusted, UNTRUSTED_POLICY } from "@/lib/ai";
import { detectLanguage, truncate } from "@/lib/text";
import type { IdeaFields } from "@/lib/types";

export const IdeaSchema = z.object({
  name: z.string().describe("Short product name. Keep the participant's name if they gave one."),
  summary: z.string().describe("One or two sentences, in English."),
  userProblem: z.string(),
  targetAudience: z.string(),
  workflow: z.string().describe("The core interaction, step by step, in one paragraph."),
  features: z.array(z.string()),
  differentiators: z.array(z.string()),
  sponsorUsage: z.string().describe("How the hackathon's sponsor technology is used, or empty if not mentioned."),
  techStack: z.array(z.string()),
  missingInformation: z.array(z.string()).describe("What the pitch does not say (problem, user, etc.)."),
});

export async function structurePitch(workspaceId: string, pitch: string, hint?: { sponsors?: string[]; nameHint?: string }) {
  const language = detectLanguage(pitch);
  const ruleBased = () => ({ idea: heuristicStructure(pitch, hint?.nameHint), language, method: "heuristic" as const, missing: [] as string[] });
  if (!isAIConfigured()) return ruleBased();
  let data: z.infer<typeof IdeaSchema>;
  try {
    ({ data } = await generateStructured({
    agent: "prism",
    workspaceId,
    schemaName: "prism_structure_pitch",
    schema: IdeaSchema,
    effort: "low",
    maxTokens: 4000,
    system: `You are Prism, the product-strategy agent in RubricRoom. Convert a participant's dictated pitch (possibly Hindi, Hinglish or mixed-language, possibly rambling) into a structured idea in English. Preserve their intent exactly: do not add features, users or claims they did not state. If something is missing, leave the field short or empty and list it in missingInformation. ${UNTRUSTED_POLICY}`,
    prompt: `${hint?.sponsors?.length ? `Hackathon sponsor technologies: ${hint.sponsors.join(", ")}\n` : ""}${hint?.nameHint ? `Name the participant chose: ${hint.nameHint}\n` : ""}Pitch:\n${wrapUntrusted({ kind: "dictated_pitch", language }, pitch, 8000)}`,
  }));
  } catch {
    return ruleBased(); // model unavailable or the AI budget is used up
  }
  const { missingInformation, ...idea } = data;
  if (hint?.nameHint) idea.name = hint.nameHint;
  return { idea: idea as IdeaFields, language, method: "ai" as const, missing: missingInformation };
}

// Explicit feature lists, most specific first: "Features: a, b and c", "It has a, b…", "including a, b".
const LIST_CUES = [/\bfeatures?\s*(?:are|include|includes|:)\s*([^.]+)/i, /\b(?:it|the app|the tool|this)\s+(?:has|offers|includes|comes with)\s+([^.]+)/i, /\bincluding\s+([^.]+)/i];

function splitList(s: string) {
  return s
    .split(/,|;|\band\b|\baur\b/i)
    .map((f) => f.trim().replace(/^(a|an|the|ek)\s+/i, ""))
    .filter((f) => f.length > 2 && f.length < 80);
}

const PRODUCT_NOUN = "tool|app|assistant|platform|bot|agent|dashboard|tracker|coach|checker|helper|copilot|planner|generator|organi[sz]er|summari[sz]er|recorder|extension|service";
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "I'm a hiring manager…" / "As a nurse…": the pitcher's own role is the most likely user. */
function pitcherRole(text: string): string | null {
  const m = text.match(/\b(?:i am|i'm|as)\s+an?\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)(?=\s+(?:at|in|for|who|and|with|working|myself)\b|[,.;]|$)/i);
  if (!m || /\b(tool|app|way|lot|bit|result|team of)\b/i.test(m[1])) return null;
  const role = m[1].trim().toLowerCase();
  const plural = /s$/.test(role) ? role : /[^aeiou]y$/.test(role) ? `${role.slice(0, -1)}ies` : `${role}s`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

const STOP = /^(for|to|so|and|or|of|that|which|who|with|in|on|at|by|from|the|a|an|their|my|our|before|after|when|into)$/i;

const FILLER = /^(my|your|our|their|his|her|its|the|a|an|dictated|spoken|clear|simple|quick|raw|all|every|each|any|some)$/i;

/** Up to three words of a phrase, skipping leading filler and stopping at the first connecting word. */
function headWords(phrase: string) {
  const words = phrase.split(/\s+/).filter(Boolean);
  while (words.length && FILLER.test(words[0])) words.shift();
  const out: string[] = [];
  for (const w of words) {
    if (STOP.test(w) || out.length === 3) break;
    out.push(w.replace(/[^a-z0-9-]/gi, ""));
  }
  return out.filter(Boolean).join(" ");
}

/** A short product name from the pitch ("a tool that summarizes interview feedback" → "Interview Feedback Tool"). */
function nameFromPitch(text: string, firstSentence: string): string {
  const m = text.match(new RegExp(`\\b(?:an?|the|my)\\s+((?:[a-z0-9-]+\\s+){0,3}?)(${PRODUCT_NOUN})\\b`, "i"));
  if (m) {
    const lead = m[1].trim();
    if (lead && !/^(simple|new|small|little|ai|smart|web|mobile|good|better)$/i.test(lead)) return titleCase(`${lead} ${m[2]}`.toLowerCase());
    const rest = text.slice(m.index! + m[0].length);
    // What it does: "…that flags risky claims…" → "Risky Claims Checker".
    const does = rest.match(/\b(?:that|which|to)\s+[a-z]+\s+([a-z-]+(?:\s+[a-z-]+){0,4})/i);
    const object = does ? headWords(does[1]) : "";
    if (object) return titleCase(`${object} ${m[2]}`.toLowerCase());
    const forWhom = rest.match(/^\s+for\s+([a-z-]+(?:\s+[a-z-]+){0,3})/i);
    if (forWhom && headWords(forWhom[1])) return titleCase(`${headWords(forWhom[1])} ${m[2]}`.toLowerCase());
  }
  const words = firstSentence.replace(/^(i want to build|i'm building|we are building|build|i am|i'm)\s+(an?|the)?\s*/i, "").replace(/[.!?]$/, "").split(/\s+/);
  return truncate(words.slice(0, 6).join(" "), 48) || "Untitled idea";
}

/** Offline structuring: keeps the pitch verbatim, splits obvious feature lists. Never invents fields. */
export function heuristicStructure(pitch: string, nameHint?: string): IdeaFields {
  const text = pitch.replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
  const named = text.match(/\b(?:called|named|name it|call it)\s+["“]?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/);
  const listed = LIST_CUES.map((re) => splitList(text.match(re)?.[1] ?? "")).find((items) => items.length >= 2);
  const withMatch = text.match(/\bwith\s+([^.]+)/i);
  const features = listed ?? (withMatch ? splitList(withMatch[1]) : []);
  const isListSentence = (s: string) => LIST_CUES.some((re) => re.test(s));
  const forMatch = text.match(/\bfor\s+((?:[a-z]+\s){0,4}(?:students|developers|teams|participants|founders|freelancers|recruiters|candidates|job seekers|creators|marketers|people|users|businesses|shops|clinics|teachers|parents))/i);
  const problem = sentences.find((s) => /\b(problem|struggle|hard|waste|lose|spend|spent|spending|slow|pain|frustrat|confus|forget|forgot|miss(es|ed)?|repeat|mistakes?|by hand|manual(ly)?|overdue|takes? (hours|too long)|took (hours|days)|\d+\s*(hours?|minutes?|days?))/i.test(s)) ?? "";
  const workflow = sentences.find((s, i) => i > 0 && s !== problem && !isListSentence(s) && /\b(after|then|first|next|once|every time|step|it (asks|turns|takes|reads|builds|checks|remembers|shows|sends|creates|drafts|schedules|tracks|finds|flags))\b/i.test(s)) ?? "";
  const diff = sentences.filter((s) => /\b(unlike|different|instead|only|remembers|retest|unique)\b/i.test(s));
  return {
    name: nameHint || named?.[1] || nameFromPitch(text, sentences.find((s) => !/^(i am|i'm|as an?)\b/i.test(s)) ?? sentences[0] ?? ""),
    summary: truncate(sentences.slice(0, 2).join(" "), 400) || text,
    userProblem: problem,
    targetAudience: pitcherRole(text) ?? forMatch?.[1] ?? "",
    workflow,
    features,
    differentiators: diff.map((d) => truncate(d, 200)),
    sponsorUsage: sentences.filter((s) => /\b(wispr|voice|dictat|speak)\b/i.test(s)).join(" "),
    techStack: [],
  };
}

// ---------------------------------------------------------------- dictated changes

export const ChangeSchema = z.object({
  summary: z.string().describe("One sentence describing the change, for the confirmation dialog."),
  name: z.string().nullable(),
  newSummary: z.string().nullable(),
  userProblem: z.string().nullable(),
  targetAudience: z.string().nullable(),
  workflow: z.string().nullable(),
  sponsorUsage: z.string().nullable(),
  removedFeatures: z.array(z.string()).describe("Exact feature strings from the current list to remove."),
  addedFeatures: z.array(z.string()),
});

/** Turn "remove the mobile app from the MVP and focus on the web dashboard" into a reviewable proposal. */
export async function proposeIdeaChange(workspaceId: string, idea: IdeaFields, instruction: string): Promise<{ proposal: import("@/lib/types").IdeaUpdateProposal; method: "ai" | "heuristic" }> {
  if (!isAIConfigured()) return { proposal: heuristicChange(idea, instruction), method: "heuristic" };
  let data: z.infer<typeof ChangeSchema>;
  try {
    ({ data } = await generateStructured({
    agent: "prism",
    workspaceId,
    schemaName: "prism_idea_change",
    schema: ChangeSchema,
    effort: "low",
    maxTokens: 2500,
    system: `You are Prism. Convert a participant's dictated change request into a precise edit of their idea. Only change what they asked. removedFeatures must be copied exactly from the current feature list. ${UNTRUSTED_POLICY}`,
    prompt: `CURRENT IDEA:\n${JSON.stringify(idea, null, 1)}\n\nREQUEST:\n${wrapUntrusted({ kind: "dictated_change" }, instruction, 3000)}`,
  }));
  } catch {
    return { proposal: heuristicChange(idea, instruction), method: "heuristic" };
  }
  const removed = data.removedFeatures.filter((f) => idea.features.includes(f));
  return {
    proposal: {
      summary: data.summary,
      changes: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.newSummary ? { summary: data.newSummary } : {}),
        ...(data.userProblem ? { userProblem: data.userProblem } : {}),
        ...(data.targetAudience ? { targetAudience: data.targetAudience } : {}),
        ...(data.workflow ? { workflow: data.workflow } : {}),
        ...(data.sponsorUsage ? { sponsorUsage: data.sponsorUsage } : {}),
      },
      removedFeatures: removed,
      addedFeatures: data.addedFeatures,
    },
    method: "ai",
  };
}

export function heuristicChange(idea: IdeaFields, instruction: string): import("@/lib/types").IdeaUpdateProposal {
  const clauses = instruction.split(/\band\b|,|;|\bbut\b|\bthen\b|(?<=[.!?])\s+/i).map((c) => c.trim()).filter(Boolean);
  const removed = new Set<string>();
  const added: string[] = [];
  const changes: Partial<IdeaFields> = {};
  const notes: string[] = [];
  for (const c of clauses) {
    if (/\b(remove|drop|cut|skip|get rid of|no longer need|don'?t need)\b/i.test(c)) {
      for (const f of idea.features) {
        const key = f.toLowerCase().split(/\s+/).map((w) => w.replace(/s$/, "")).filter((w) => w.length > 3);
        if (key.some((w) => c.toLowerCase().includes(w))) removed.add(f);
      }
    } else if (/^\s*(add|include|also support)\b/i.test(c)) {
      const what = c.replace(/^\s*(add|include|also support)\s+(a|an|the)?\s*/i, "").replace(/\s+(to|in(to)?) the (mvp|plan|scope|idea)\.?$/i, "").trim();
      if (what.length > 2) added.push(what.charAt(0).toUpperCase() + what.slice(1));
    } else if (/\b(rename|call it)\b/i.test(c)) {
      const m = c.match(/\b(?:rename(?: it)?(?: to)?|call it)\s+["“]?([^"”.]+)/i);
      if (m) changes.name = m[1].trim();
    } else if (/\b(focus|target|for)\b/i.test(c)) {
      notes.push(c);
    }
  }
  if (notes.length) changes.summary = `${idea.summary} Focus: ${notes.join("; ")}`;
  const parts = [removed.size ? `remove ${[...removed].join(", ")}` : "", added.length ? `add ${added.join(", ")}` : "", changes.name ? `rename to ${changes.name}` : "", notes.length ? `note focus (“${truncate(notes.join("; "), 80)}”)` : ""].filter(Boolean);
  return { summary: parts.length ? `Proposed: ${parts.join("; ")}.` : `Note added: ${truncate(instruction, 160)}`, changes: parts.length ? changes : { summary: `${idea.summary} Note: ${truncate(instruction, 240)}` }, removedFeatures: [...removed], addedFeatures: added };
}

// ---------------------------------------------------------------- comparison

export interface ComparableIdea {
  id: string;
  name: string;
  summary: string;
  problem: string;
  audience: string;
  features: string[];
  weightedTotal: number | null;
  ratings: { name: string; rating: number; weight: number | null }[];
  heuristics: Record<string, number>;
  strongestOverlap: string | null;
  personalRelevance: boolean | null;
  evidenceCount: number;
  feasibility: { complexity: number; demoReliability: number } | null;
}

export const PrismCompareSchema = z.object({
  overview: z.string().describe("3-5 sentences comparing the ideas honestly."),
  perIdea: z.array(z.object({ ideaId: z.string(), strengths: z.array(z.string()), uncertainties: z.array(z.string()), biggestRisk: z.string() })),
  betterSupported: z.array(z.object({ dimension: z.string(), ideaId: z.string(), why: z.string() })),
  lowerRiskIdeaId: z.string().nullable(),
  clearerDemoIdeaId: z.string().nullable(),
  caution: z.string().describe("What remains uncertain about this comparison."),
});

export type IdeaComparison = z.infer<typeof PrismCompareSchema> & { method: "ai" | "heuristic" };

export async function compareIdeas(workspaceId: string, ideas: ComparableIdea[]): Promise<IdeaComparison> {
  if (!isAIConfigured()) return heuristicCompare(ideas);
  let data: z.infer<typeof PrismCompareSchema>;
  try {
    ({ data } = await generateStructured({
    agent: "prism",
    workspaceId,
    schemaName: "prism_compare_ideas",
    schema: PrismCompareSchema,
    effort: "low",
    maxTokens: 5000,
    system: `You are Prism, comparing hackathon project ideas using ONLY the provided assessments and research. Ratings are AI-assisted planning estimates, not official scores. Never say an idea will win. Point out where evidence is thin. Use the exact idea ids.`,
    prompt: JSON.stringify(ideas, null, 1),
  }));
  } catch {
    return heuristicCompare(ideas);
  }
  return { ...data, method: "ai" };
}

export function heuristicCompare(ideas: ComparableIdea[]): IdeaComparison {
  const byTotal = [...ideas].sort((a, b) => (b.weightedTotal ?? -1) - (a.weightedTotal ?? -1));
  const risk = (i: ComparableIdea) => (i.heuristics.scopeRisk ?? 3) + (5 - (i.heuristics.feasibility ?? 3)) + (5 - (i.heuristics.demoReliability ?? 3));
  const lowerRisk = [...ideas].sort((a, b) => risk(a) - risk(b))[0];
  const demoRating = (i: ComparableIdea) => i.ratings.find((r) => /demo|clear|present/i.test(r.name))?.rating ?? i.heuristics.demoReliability ?? 0;
  const clearerDemo = [...ideas].sort((a, b) => demoRating(b) - demoRating(a))[0];
  const better: IdeaComparison["betterSupported"] = [];
  const criterionNames = [...new Set(ideas.flatMap((i) => i.ratings.map((r) => r.name)))];
  for (const name of criterionNames) {
    const ranked = ideas.map((i) => ({ i, r: i.ratings.find((x) => x.name === name)?.rating ?? 0 })).sort((a, b) => b.r - a.r);
    if (ranked.length > 1 && ranked[0].r > ranked[1].r) better.push({ dimension: name, ideaId: ranked[0].i.id, why: `${ranked[0].r}/5 vs ${ranked[1].r}/5 in the current assessments.` });
  }
  return {
    overview:
      byTotal.length > 1
        ? `${byTotal[0].name} currently has the highest weighted planning estimate (${byTotal[0].weightedTotal ?? "—"}), ${byTotal[1].name} next (${byTotal[1].weightedTotal ?? "—"}). These are rule-based estimates; differences of a few points are within noise.`
        : "Add at least two assessed ideas to compare.",
    perIdea: ideas.map((i) => ({
      ideaId: i.id,
      strengths: i.ratings.filter((r) => r.rating >= 3).map((r) => `${r.name}: ${r.rating}/5`),
      uncertainties: [
        ...(i.strongestOverlap ? [`Closest existing project overlap: ${i.strongestOverlap}`] : ["Competitor research not run yet"]),
        ...(i.personalRelevance ? [] : ["No first-hand experience recorded"]),
        ...(i.evidenceCount ? [] : ["No supporting evidence attached"]),
      ],
      biggestRisk: (i.heuristics.scopeRisk ?? 0) >= 4 ? "Scope is large for the time available." : (i.heuristics.feasibility ?? 5) <= 2 ? "Technical feasibility is low." : "Evidence is still thin.",
    })),
    betterSupported: better,
    lowerRiskIdeaId: lowerRisk?.id ?? null,
    clearerDemoIdeaId: clearerDemo?.id ?? null,
    caution: "Comparison uses rule-based estimates (no AI provider configured). Ratings move only when evidence is added.",
    method: "heuristic",
  };
}
