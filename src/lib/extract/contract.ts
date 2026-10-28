import { z } from "zod";
import type { MarkupHint, SourceType } from "@/lib/types";

/** What extractors receive: retrieved source text plus provenance. `ref` is the index used in citations. */
export interface SourceForExtraction {
  ref: number;
  sourceId: string;
  url: string;
  title: string | null;
  sourceType: SourceType;
  authority: number;
  publishedAt: string | null;
  retrievedAt: string | null;
  text: string;
  markupHints: MarkupHint[];
}

// Every extracted item carries the source ref and a verbatim quote so it can be checked against the text.
const cite = { sourceRef: z.number().int(), quote: z.string() };

export const FACT_FIELDS = [
  "name",
  "organizer",
  "description",
  "theme",
  "format",
  "location",
  "eligibility",
  "team_size",
  "age",
  "registration",
  "start_date",
  "deadline",
  "timezone",
  "judging_dates",
  "winner_announcement",
  "required_accounts",
  "ai_tools",
  "open_source",
  "ip",
  "hardware",
  "cost",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export const ExtractionSchema = z.object({
  name: z.string(),
  organizer: z.string(),
  summary: z.string().describe("Plain-language explanation of the hackathon in 2-4 sentences, only from the sources."),
  whatToBuild: z.string().describe("What a suitable project should accomplish, in plain language."),
  facts: z.array(
    z.object({
      field: z.enum(FACT_FIELDS),
      value: z.string().describe("Normalized value, e.g. an ISO-8601 instant for dates when the source states enough."),
      dateIso: z.string().nullable().describe("ISO-8601 instant for date fields, or null if not derivable without guessing."),
      confidence: z.enum(["high", "medium", "low"]),
      note: z.string().nullable(),
      ...cite,
    }),
  ),
  criteria: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      weight: z.number().nullable().describe("Percent weight as published. null if not published."),
      weightFromMarkupHint: z.boolean().describe("true only if the weight came from a MARKUP HINT, not visible text."),
      track: z.string().nullable(),
      ...cite,
    }),
  ),
  rules: z.array(
    z.object({
      category: z.enum(["eligibility", "team", "submission", "technology", "conduct", "ip", "judging", "timeline", "other"]),
      text: z.string(),
      level: z.enum(["mandatory", "recommended", "unclear"]),
      applicability: z.string().nullable(),
      ...cite,
    }),
  ),
  tracks: z.array(z.object({ name: z.string(), audience: z.string(), description: z.string(), ...cite })),
  submission: z.array(
    z.object({
      key: z.enum(["project_url", "repository", "demo_video", "screenshots", "presentation", "description", "usage_evidence", "sponsor_integration", "form", "other"]),
      label: z.string(),
      detail: z.string().nullable(),
      required: z.boolean(),
      ...cite,
    }),
  ),
  prizes: z.array(z.object({ text: z.string(), ...cite })),
  timeline: z.array(z.object({ label: z.string(), dateText: z.string(), dateIso: z.string().nullable(), ...cite })),
  sponsors: z.array(z.object({ name: z.string(), technology: z.string(), usageRequirement: z.string(), ...cite })),
  judgesReward: z.array(z.object({ text: z.string(), ...cite })),
  prohibited: z.array(z.object({ text: z.string(), ...cite })),
  mandatory: z.array(z.object({ text: z.string(), ...cite })),
  recommendations: z.array(z.object({ text: z.string(), ...cite })),
  uncertainties: z.array(z.string()).describe("Things the sources do not establish, or that remain ambiguous."),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export function emptyExtraction(): Extraction {
  return {
    name: "",
    organizer: "",
    summary: "",
    whatToBuild: "",
    facts: [],
    criteria: [],
    rules: [],
    tracks: [],
    submission: [],
    prizes: [],
    timeline: [],
    sponsors: [],
    judgesReward: [],
    prohibited: [],
    mandatory: [],
    recommendations: [],
    uncertainties: [],
  };
}
