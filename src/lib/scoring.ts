// AI-assisted *planning estimate*. Never an official score, a predicted judge score, or a win probability.

import type { CriterionResult, WeightBasis } from "@/lib/types";

export const SCORE_MODEL_VERSION = "rr-score-1 (0–5 per criterion, weighted to 100)";
export const RATING_SCALE: Record<number, string> = {
  0: "No support",
  1: "Weak — major gaps",
  2: "Partial — key evidence missing",
  3: "Reasonable — some evidence",
  4: "Strong — well supported",
  5: "Exceptional — independently verified",
};

export interface CriterionWeightInput {
  id: string;
  name: string;
  weight: number | null;
  weightBasis?: WeightBasis;
  track?: string | null;
}

export interface NormalizedWeights {
  weights: Map<string, number>;
  basis: WeightBasis;
  note: string;
}

/** Criteria that apply to a track: track-agnostic ones plus those for the chosen track. */
export function criteriaForTrack<T extends { track?: string | null }>(criteria: T[], track?: string | null): T[] {
  if (!track) return criteria.filter((c) => !c.track) .length ? criteria.filter((c) => !c.track) : criteria;
  const t = track.toLowerCase();
  const matching = criteria.filter((c) => !c.track || c.track.toLowerCase() === t);
  return matching.length ? matching : criteria;
}

export function normalizeWeights(criteria: CriterionWeightInput[]): NormalizedWeights {
  const weights = new Map<string, number>();
  if (criteria.length === 0) return { weights, basis: "illustrative", note: "No judging criteria are available for this hackathon." };
  const allWeighted = criteria.every((c) => typeof c.weight === "number" && c.weight > 0);
  if (!allWeighted) {
    const each = Math.round((100 / criteria.length) * 100) / 100;
    for (const c of criteria) weights.set(c.id, each);
    return {
      weights,
      basis: "illustrative",
      note: "Official weights were not published for every criterion, so equal illustrative weights are used. Treat the total as a rough planning aid only.",
    };
  }
  const sum = criteria.reduce((s, c) => s + (c.weight as number), 0);
  const viaMarkup = criteria.some((c) => c.weightBasis === "markup_recovered");
  if (Math.abs(sum - 100) < 0.5) {
    for (const c of criteria) weights.set(c.id, c.weight as number);
    return {
      weights,
      basis: viaMarkup ? "markup_recovered" : "official",
      note: viaMarkup
        ? "Official weights, recovered from the judging page markup (the page animates them from 0%)."
        : "Official published weights.",
    };
  }
  for (const c of criteria) weights.set(c.id, Math.round(((c.weight as number) * 100 * 100) / sum) / 100);
  return { weights, basis: "normalized", note: `Published weights sum to ${sum}; they were scaled proportionally to 100.` };
}

/** Weighted assessment = Σ (rating / 5 × weight). Ratings are clamped to 0–5. */
export function weightedTotal(results: Pick<CriterionResult, "criterionId" | "rating">[], weights: Map<string, number>): number {
  let total = 0;
  for (const r of results) {
    const w = weights.get(r.criterionId);
    if (w === undefined) continue;
    const rating = Math.min(5, Math.max(0, r.rating));
    total += (rating / 5) * w;
  }
  return Math.round(total * 10) / 10;
}

export function ratingLabel(rating: number) {
  return RATING_SCALE[Math.round(Math.min(5, Math.max(0, rating)))];
}

export const WEIGHT_BASIS_LABEL: Record<WeightBasis, string> = {
  official: "Official weights",
  markup_recovered: "Official weights (recovered from page markup)",
  normalized: "Official weights, normalized to 100",
  illustrative: "Illustrative equal weights (not official)",
};
