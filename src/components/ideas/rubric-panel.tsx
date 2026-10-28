import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { RATING_SCALE, WEIGHT_BASIS_LABEL } from "@/lib/scoring";
import { cn } from "@/lib/utils";
import type { CriterionResult, HeuristicDimensions, WeightBasis } from "@/lib/types";

export function RatingDots({ rating, previous, size = "md" }: { rating: number; previous?: number; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rating} of 5`} title={RATING_SCALE[Math.round(rating)]}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= rating;
        const gained = previous !== undefined && i > previous && i <= rating;
        const lost = previous !== undefined && i <= previous && i > rating;
        return (
          <span
            key={i}
            className={cn(
              "rounded-full",
              size === "sm" ? "size-2" : "size-2.5",
              gained ? "bg-teal ring-2 ring-teal/30" : lost ? "bg-coral/30 ring-1 ring-coral" : filled ? "bg-primary" : "bg-muted",
            )}
          />
        );
      })}
    </span>
  );
}

export function Delta({ from, to }: { from: number; to: number }) {
  if (from === to) return null;
  const up = to > from;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-teal" : "text-coral")}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {from}→{to}
    </span>
  );
}

export function RubricPanel({
  results,
  previous,
  total,
  previousTotal,
  basis,
  method,
  compact = false,
}: {
  results: CriterionResult[];
  previous?: CriterionResult[] | null;
  total: number | null;
  previousTotal?: number | null;
  basis: WeightBasis;
  method: string;
  compact?: boolean;
}) {
  if (!results.length) {
    return <p className="text-sm text-muted-foreground">No rubric criteria are available for this hackathon, so nothing has been assessed yet.</p>;
  }
  return (
    <div className="space-y-4" data-testid="rubric-panel">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Weighted planning estimate</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums" data-testid="weighted-total">
              {total ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            {previousTotal != null && total != null && previousTotal !== total && (
              <span className={cn("text-sm font-medium", total > previousTotal ? "text-teal" : "text-coral")}>
                {total > previousTotal ? "+" : ""}
                {Math.round((total - previousTotal) * 10) / 10}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={method === "ai" ? "primary" : "gray"}>{method === "ai" ? "Verdict (AI)" : "Rule-based"}</Badge>
          <span className="text-right text-[11px] text-muted-foreground">{WEIGHT_BASIS_LABEL[basis]}</span>
        </div>
      </div>
      <ul className="space-y-3">
        {results.map((r) => {
          const prev = previous?.find((p) => p.criterionId === r.criterionId);
          return (
            <li key={r.criterionId} className={cn("rounded-lg border p-3", prev && prev.rating !== r.rating && (r.rating > prev.rating ? "border-teal/40 bg-teal-soft/40" : "border-coral/40 bg-coral-soft/40"))} data-testid="criterion-row">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-snug">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.weight !== null ? `${r.weight}% weight` : "weight not published"}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <RatingDots rating={r.rating} previous={prev?.rating} />
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {prev && <Delta from={prev.rating} to={r.rating} />}
                    <span data-testid="criterion-rating">{r.rating}/5</span>
                  </span>
                </div>
              </div>
              {!compact && (
                <>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{r.rationale}</p>
                  {r.evidence.some((e) => e.kind === "debate_claim") && (
                    <ul className="mt-2 space-y-1">
                      {r.evidence
                        .filter((e) => e.kind === "debate_claim")
                        .map((e, i) => (
                          <li key={i} className="flex gap-1.5 text-xs">
                            <Badge tone="teal">Debate evidence</Badge> <span className="text-muted-foreground">{e.label}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  {r.gaps.length > 0 && <p className="mt-1.5 text-xs text-coral/90">Gap: {r.gaps[0]}</p>}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-px size-3 shrink-0" /> AI-assisted planning estimate: Σ(rating ÷ 5 × weight). This is not an official score, a predicted judge score, or a chance of winning.
      </p>
    </div>
  );
}

const DIM_ORDER: (keyof HeuristicDimensions)[] = ["feasibility", "demoReliability", "personalRelevance", "researchConfidence", "competitorOverlap", "scopeRisk"];
const RISKY = new Set(["competitorOverlap", "scopeRisk"]);

export function HeuristicPanel({ heuristics }: { heuristics: HeuristicDimensions }) {
  return (
    <div className="space-y-2.5" data-testid="heuristics">
      <p className="text-xs text-muted-foreground">Tracked separately from the official rubric and never mixed into the weighted estimate.</p>
      {DIM_ORDER.map((k) => {
        const d = heuristics[k];
        if (!d) return null;
        const risky = RISKY.has(k);
        return (
          <div key={k} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm">{d.label}</div>
              <div className="text-xs text-muted-foreground">{d.rationale}</div>
            </div>
            <span className={cn("shrink-0 text-xs font-medium tabular-nums", risky ? (d.rating >= 4 ? "text-coral" : "text-muted-foreground") : d.rating <= 2 ? "text-coral" : "text-foreground")}>
              {d.rating}/5{risky ? " risk" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
