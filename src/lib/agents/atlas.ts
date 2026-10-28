// Atlas — Event Analyst. Turns retrieved official pages into a cited event dossier.
// With an AI provider it reads the sources and extracts structured facts with verbatim quotes;
// without one it uses the deterministic extractor. Either way, every claim is later checked
// against the retrieved text (research/verify.ts) before it is shown as verified.

import { z } from "zod";
import { countKey, generateStructured, isAIConfigured, partialString, UNTRUSTED_POLICY, wrapUntrusted } from "@/lib/ai";
import { emptyExtraction, FACT_FIELDS, type Extraction, type FactField, type SourceForExtraction } from "@/lib/extract/contract";
import { heuristicExtract } from "@/lib/extract/heuristics";
import { authorityLabel } from "@/lib/research/verify";
import { hostOf, isPlaceholder } from "@/lib/text";

const SYSTEM = `You are Atlas, the event-analysis agent inside RubricRoom. You build a factual dossier of a hackathon from the retrieved sources provided.

Rules:
- Extract ONLY what the sources state. Never invent dates, prizes, criteria, sponsors, requirements or URLs. If a field is not established, leave it out and add an uncertainty.
- Every entry needs sourceRef (the ref number of the source) and a SHORT verbatim quote copied exactly from that source's text (max ~30 words). RubricRoom checks each quote against the text and downgrades anything it cannot find.
- Source authority (1 = strongest): 1 current official rules/schedule, 2 official judging/track pages, 3 official updates, 4 official FAQ, 5 organizer blog, 6 secondary coverage, 7 community discussion. When sources conflict, still report each value (one fact per source) so RubricRoom can show the conflict; do not silently pick one.
- Dates: set dateIso only when the day, month and year are determinable (a year stated elsewhere on the same official site counts; say so in note). If the time or timezone is not stated, say so in note.
- Judging weights: use the visible text. Some pages animate counters from "0%"; if a MARKUP HINT pairs a value with a criterion label, use it and set fromMarkupHint=true.
- Distinguish mandatory requirements (required=true) from recommendations (required=false).
- "track" items are the competition tracks a participant chooses between. Bonus or special prizes are "prize" items, not tracks.
- The judging_dates fact is only for when judging happens or scores are published. Other dates (appeal windows, announcements) are "timeline" items.
- The timezone fact must be an IANA zone name such as Asia/Kolkata when the source makes it clear; otherwise omit it.
${UNTRUSTED_POLICY}`;

const cite = { sourceRef: z.number().int(), quote: z.string() };

const ITEM_KINDS = ["rule", "track", "submission", "prize", "timeline", "sponsor", "judges_reward", "prohibited", "mandatory", "recommendation"] as const;
const RULE_CATEGORIES = ["eligibility", "team", "submission", "technology", "conduct", "ip", "judging", "timeline", "other"] as const;
const SUBMISSION_KEYS = ["project_url", "repository", "demo_video", "screenshots", "presentation", "description", "usage_evidence", "sponsor_integration", "form", "other"] as const;

/**
 * Deliberately flat: the API compiles a grammar from the schema, and one object type per dossier
 * section made it too large. Everything list-shaped is an `item` with a `kind`; code maps it back.
 */
export const AtlasCompactSchema = z.object({
  name: z.string(),
  organizer: z.string(),
  summary: z.string().describe("Plain-language explanation of the hackathon in 2-4 sentences, only from the sources."),
  whatToBuild: z.string().describe("What a suitable project should accomplish, in plain language."),
  facts: z.array(
    z.object({
      field: z.string().describe(`One of: ${FACT_FIELDS.join(", ")}`),
      value: z.string(),
      dateIso: z.string().nullable().describe("ISO-8601 instant for date fields, or null if not derivable without guessing."),
      note: z.string().nullable(),
      ...cite,
    }),
  ),
  criteria: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      weight: z.number().nullable().describe("Percent weight as published; null if not published."),
      fromMarkupHint: z.boolean(),
      track: z.string().nullable(),
      ...cite,
    }),
  ),
  items: z.array(
    z.object({
      kind: z.enum(ITEM_KINDS),
      text: z.string().describe("The rule / track name / deliverable / prize / timeline label / sponsor name / statement."),
      tag: z
        .string()
        .nullable()
        .describe(`rule: one of ${RULE_CATEGORIES.join("|")}; submission: one of ${SUBMISSION_KEYS.join("|")}; track: who it is for; sponsor: the technology; timeline: the date as written`),
      detail: z.string().nullable().describe("track: description; submission: limits such as max video length; sponsor: usage requirement"),
      required: z.boolean(),
      dateIso: z.string().nullable(),
      ...cite,
    }),
  ),
  uncertainties: z.array(z.string()),
});

export type AtlasCompact = z.infer<typeof AtlasCompactSchema>;

/** Map the flat model output onto the dossier contract, dropping anything outside the known vocabulary. */
export function compactToExtraction(c: AtlasCompact): Extraction {
  const x = emptyExtraction();
  x.name = c.name;
  x.organizer = c.organizer;
  x.summary = c.summary;
  x.whatToBuild = c.whatToBuild;
  x.uncertainties = c.uncertainties;
  for (const f of c.facts) {
    if (!(FACT_FIELDS as readonly string[]).includes(f.field)) continue;
    x.facts.push({ field: f.field as FactField, value: f.value, dateIso: f.dateIso, confidence: f.note && /assum|infer|not stated/i.test(f.note) ? "medium" : "high", note: f.note, sourceRef: f.sourceRef, quote: f.quote });
  }
  x.criteria = c.criteria.map((k) => ({ name: k.name, description: k.description, weight: k.weight, weightFromMarkupHint: k.fromMarkupHint, track: k.track, sourceRef: k.sourceRef, quote: k.quote }));
  for (const it of c.items) {
    const base = { sourceRef: it.sourceRef, quote: it.quote };
    switch (it.kind) {
      case "rule":
        x.rules.push({ category: (RULE_CATEGORIES as readonly string[]).includes(it.tag ?? "") ? (it.tag as (typeof RULE_CATEGORIES)[number]) : "other", text: it.text, level: it.required ? "mandatory" : "recommended", applicability: null, ...base });
        break;
      case "track":
        x.tracks.push({ name: it.text, audience: it.tag ?? "", description: it.detail ?? "", ...base });
        break;
      case "submission":
        x.submission.push({ key: (SUBMISSION_KEYS as readonly string[]).includes(it.tag ?? "") ? (it.tag as (typeof SUBMISSION_KEYS)[number]) : "other", label: it.text, detail: it.detail, required: it.required, ...base });
        break;
      case "timeline":
        x.timeline.push({ label: it.text, dateText: it.tag ?? it.detail ?? "", dateIso: it.dateIso, ...base });
        break;
      case "sponsor":
        x.sponsors.push({ name: it.text, technology: it.tag ?? it.text, usageRequirement: it.detail ?? "", ...base });
        break;
      case "prize":
        x.prizes.push({ text: it.text, ...base });
        break;
      case "judges_reward":
        x.judgesReward.push({ text: it.text, ...base });
        break;
      case "prohibited":
        x.prohibited.push({ text: it.text, ...base });
        break;
      case "mandatory":
        x.mandatory.push({ text: it.text, ...base });
        break;
      case "recommendation":
        x.recommendations.push({ text: it.text, ...base });
        break;
    }
  }
  return x;
}

/** The page's own name for the event (deterministic extractor), else its cleaned title, else the domain. */
export function fallbackName(heuristic: Extraction, sources: SourceForExtraction[]) {
  if (!isPlaceholder(heuristic.name)) return heuristic.name;
  const primary = sources[0];
  const title = primary?.title?.split(/\s+[|·–—-]\s+/)[0]?.trim();
  if (title && !isPlaceholder(title)) return title;
  return primary ? hostOf(primary.url) : "Hackathon";
}

/** What Atlas has written so far, in words: "OpenMetadata Hackathon · 9 facts, 4 judging criteria and 12 rules or requirements so far". */
export function describeDossierProgress(json: string, sourceCount: number) {
  const name = partialString(json, "name");
  const facts = countKey(json, "field");
  const criteria = countKey(json, "fromMarkupHint");
  const items = countKey(json, "kind");
  if (!name) return `Atlas is reading ${sourceCount} source(s)…`;
  const named = name.complete && !isPlaceholder(name.value) ? `“${name.value}” · ` : "";
  return `Atlas is writing the dossier: ${named}${facts} fact(s), ${criteria} judging criteria and ${items} rule(s), track(s) or requirement(s) so far.`;
}

export async function atlasExtract(
  workspaceId: string,
  sources: SourceForExtraction[],
  opts: { onProgress?: (detail: string) => void } = {},
): Promise<{ extraction: Extraction; method: "ai" | "heuristic"; notes: string[] }> {
  const heuristic = heuristicExtract(sources);
  if (!isAIConfigured() || sources.length === 0) {
    return { extraction: heuristic, method: "heuristic", notes: ["Extracted with the deterministic parser (no AI provider configured)."] };
  }
  const budgetPerSource = Math.max(6000, Math.floor(90_000 / sources.length));
  const blocks = sources
    .map((s) => {
      const hints = s.markupHints.length ? `\nMARKUP HINTS (from page HTML, not visible text):\n${s.markupHints.map((h) => `- ${h.text}`).join("\n")}` : "";
      return wrapUntrusted(
        { ref: s.ref, url: s.url, title: s.title, authority: `${s.authority} (${authorityLabel(s.authority)})`, published: s.publishedAt, retrieved: s.retrievedAt },
        `${s.text}${hints}`,
        budgetPerSource,
      );
    })
    .join("\n\n");

  const { data: compact } = await generateStructured({
    agent: "atlas",
    workspaceId,
    schemaName: "atlas_event_dossier",
    schema: AtlasCompactSchema,
    // Extraction needs little reasoning: on real event pages the lightest level took 32–40 s instead
    // of 57–77 s, with the same share of quotes verified against the source text (83–89%).
    effort: "low",
    maxTokens: 16_000,
    onText: opts.onProgress ? (json) => opts.onProgress?.(describeDossierProgress(json, sources.length)) : undefined,
    system: SYSTEM,
    prompt: `Retrieved sources for one hackathon:\n\n${blocks}\n\nBuild the dossier. Today is ${new Date().toISOString().slice(0, 10)}.`,
  });
  const data = compactToExtraction(compact);

  // Never show a model's placeholder ("[Name not explicitly stated on page]") as the event name:
  // fall back to the name the page itself gives (title, heading or address), then the domain.
  const notes: string[] = ["Extracted by Atlas (AI); every quote is re-checked against the source text below."];
  if (isPlaceholder(data.name)) {
    data.name = fallbackName(heuristic, sources);
    data.facts = data.facts.filter((f) => f.field !== "name");
    const cited = heuristic.facts.find((f) => f.field === "name" && f.value === data.name);
    if (cited) data.facts.push(cited);
    notes.push(`The model did not find an event name, so the name comes from the page itself (“${data.name}”).`);
  }
  if (isPlaceholder(data.organizer)) data.organizer = isPlaceholder(heuristic.organizer) ? "" : heuristic.organizer;
  data.facts = data.facts.filter((f) => !isPlaceholder(f.value));

  // Cross-check the deadline with the deterministic parser; disagreement becomes a visible note.
  const aiDeadline = data.facts.find((f) => f.field === "deadline")?.dateIso;
  const hDeadline = heuristic.facts.find((f) => f.field === "deadline")?.dateIso;
  if (aiDeadline && hDeadline && Math.abs(new Date(aiDeadline).getTime() - new Date(hDeadline).getTime()) > 60_000) {
    notes.push(`Cross-check: the deterministic date parser read the deadline as ${hDeadline}, the model as ${aiDeadline}. Check the source quote.`);
  }
  // Weights the model missed but the markup recovery found are added back, labelled as such.
  for (const c of data.criteria) {
    if (c.weight === null || c.weight === 0) {
      const h = heuristic.criteria.find((x) => x.name.toLowerCase() === c.name.toLowerCase() && x.weight);
      if (h) {
        c.weight = h.weight;
        c.weightFromMarkupHint = h.weightFromMarkupHint;
      }
    }
  }
  return { extraction: data, method: "ai", notes };
}
