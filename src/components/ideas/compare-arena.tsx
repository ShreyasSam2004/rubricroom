"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BadgeCheck, Columns3, Sparkles, Undo2 } from "lucide-react";
import { RatingDots } from "@/components/ideas/rubric-panel";
import { OverlapBadge } from "@/components/research/badges";
import { AiProgress } from "@/components/ui/ai-progress";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { OverlapLevel } from "@/lib/types";

export interface CompareIdea {
  id: string;
  name: string;
  status: string;
  origin: string;
  problem: string;
  audience: string;
  sponsorUsage: string;
  features: string[];
  personal: boolean | null;
  total: number | null;
  basisLabel: string;
  ratings: { name: string; rating: number; weight: number | null }[];
  heur: Record<string, { rating: number; rationale: string }>;
  overlap: { level: OverlapLevel; name: string } | null;
  evidence: number;
  gaps: string[];
  feasibility: { complexity: number; demoReliability: number; low: number; high: number } | null;
}

interface Comparison {
  overview: string;
  perIdea: { ideaId: string; strengths: string[]; uncertainties: string[]; biggestRisk: string }[];
  betterSupported: { dimension: string; ideaId: string; why: string }[];
  lowerRiskIdeaId: string | null;
  clearerDemoIdeaId: string | null;
  caution: string;
  method: "ai" | "heuristic";
}

export function CompareArena({ ideas }: { ideas: CompareIdea[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(() => ideas.slice(0, Math.min(3, ideas.length)).map((i) => i.id));
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = useMemo(() => ideas.filter((i) => selected.includes(i.id)), [ideas, selected]);
  const nameOf = (id: string | null) => ideas.find((i) => i.id === id)?.name ?? "—";

  if (ideas.length < 2) return <EmptyState icon={<Columns3 />} title="You need at least two ideas to compare" description="Pitch ideas in My Ideas, or save some from Opportunity Radar." />;

  async function compare() {
    setBusy("compare");
    setSince(Date.now());
    setError(null);
    try {
      const { comparison: c } = await api<{ comparison: Comparison }>("/api/compare", { ideaIds: selected });
      setComparison(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setSince(null);
    }
  }

  async function select(id: string, action: "select" | "unselect") {
    setBusy(id);
    try {
      await api(`/api/ideas/${id}`, { action });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rows: { label: string; render: (i: CompareIdea) => React.ReactNode }[] = [
    { label: "Target problem", render: (i) => <span className="text-sm">{i.problem || <em className="text-muted-foreground">not stated</em>}</span> },
    { label: "Personal relevance", render: (i) => (i.personal ? <Badge tone="teal">You have this problem (user-reported)</Badge> : i.personal === false ? <Badge tone="gray">Not your problem</Badge> : <Badge tone="outline">Not stated</Badge>) },
    {
      label: "Rubric alignment",
      render: (i) => (
        <div className="space-y-1.5">
          <div className="text-lg font-semibold tabular-nums">
            {i.total ?? "—"} <span className="text-xs font-normal text-muted-foreground">/ 100 estimate</span>
          </div>
          {i.ratings.map((r) => (
            <div key={r.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{r.name}</span>
              <RatingDots rating={r.rating} size="sm" />
            </div>
          ))}
        </div>
      ),
    },
    { label: "Competitor overlap", render: (i) => (i.overlap ? <div className="space-y-1"><OverlapBadge level={i.overlap.level} /><div className="text-xs text-muted-foreground">closest: {i.overlap.name}</div></div> : <Badge tone="outline">Not researched</Badge>) },
    { label: "Technical feasibility", render: (i) => <Heur v={i.heur.feasibility} /> },
    { label: "Scope", render: (i) => <Heur v={i.heur.scopeRisk} risk /> },
    { label: "Demo potential", render: (i) => <Heur v={i.heur.demoReliability} /> },
    { label: "Sponsor usage", render: (i) => <span className="text-xs text-muted-foreground">{i.sponsorUsage || "not stated"}</span> },
    { label: "Evidence quality", render: (i) => <span className="text-xs">{i.evidence} debate claim(s) accepted · research confidence {i.heur.researchConfidence?.rating ?? "—"}/5</span> },
    { label: "Biggest risks", render: (i) => <ul className="space-y-0.5 text-xs text-muted-foreground">{i.gaps.slice(0, 3).map((g, k) => <li key={k}>• {g}</li>)}</ul> },
  ];

  return (
    <div className="space-y-5" data-testid="compare-arena">
      <div className="flex flex-wrap gap-2">
        {ideas.map((i) => {
          const on = selected.includes(i.id);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => setSelected(on ? selected.filter((x) => x !== i.id) : selected.length < 5 ? [...selected, i.id] : selected)}
              className={cn("rounded-full border px-3 py-1.5 text-sm", on ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted")}
              aria-pressed={on}
            >
              {i.name}
            </button>
          );
        })}
        <Button size="sm" className="ml-auto" onClick={compare} loading={busy === "compare"} disabled={selected.length < 2} data-testid="run-compare">
          <Sparkles /> Explain the differences
        </Button>
      </div>
      {since !== null && <AiProgress since={since} label="Prism is comparing the ideas side by side" expected="8–15 seconds" />}
      {error && <Callout tone="danger">{error}</Callout>}
      {comparison && (
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm" data-testid="comparison">
            <div className="flex items-center gap-2">
              <span className="font-medium">Prism&apos;s comparison</span>
              <Badge tone={comparison.method === "ai" ? "primary" : "gray"}>{comparison.method === "ai" ? "AI" : "Rule-based"}</Badge>
            </div>
            <p className="leading-relaxed">{comparison.overview}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-2.5">
                <div className="text-xs text-muted-foreground">Lower implementation risk</div>
                <div className="font-medium">{nameOf(comparison.lowerRiskIdeaId)}</div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-xs text-muted-foreground">Clearer demonstration</div>
                <div className="font-medium">{nameOf(comparison.clearerDemoIdeaId)}</div>
              </div>
            </div>
            {comparison.betterSupported.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {comparison.betterSupported.map((b, k) => (
                  <li key={k}>
                    <span className="font-medium text-foreground">{b.dimension}:</span> {nameOf(b.ideaId)} is better supported — {b.why}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{comparison.caution}</p>
          </CardContent>
        </Card>
      )}
      <div className="scrollbar-thin overflow-x-auto">
        <div className="grid min-w-[640px] gap-3" style={{ gridTemplateColumns: `160px repeat(${chosen.length}, minmax(200px, 1fr))` }}>
          <div />
          {chosen.map((i) => (
            <div key={i.id} className="rounded-xl border bg-card p-3">
              <div className="font-semibold">{i.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{i.basisLabel}</div>
              <div className="mt-2">
                {i.status === "selected" ? (
                  <Button size="xs" variant="outline" loading={busy === i.id} onClick={() => select(i.id, "unselect")}>
                    <Undo2 /> Reopen decision
                  </Button>
                ) : (
                  <Button size="xs" variant="teal" loading={busy === i.id} onClick={() => select(i.id, "select")} data-testid="compare-select">
                    <BadgeCheck /> Select as My Project
                  </Button>
                )}
              </div>
            </div>
          ))}
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <div className="flex items-start py-2 text-xs font-medium text-muted-foreground">{row.label}</div>
              {chosen.map((i) => (
                <div key={i.id} className="rounded-lg border bg-card p-3">
                  {row.render(i)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Ratings are AI-assisted planning estimates, not predictions. Selecting a project is your decision, and you can reopen it at any time.</p>
    </div>
  );
}

function Heur({ v, risk }: { v?: { rating: number; rationale: string }; risk?: boolean }) {
  if (!v) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div>
      <div className={cn("text-sm font-medium", risk ? (v.rating >= 4 ? "text-coral" : "") : v.rating <= 2 ? "text-coral" : "")}>
        {v.rating}/5{risk ? " risk" : ""}
      </div>
      <div className="text-xs text-muted-foreground">{v.rationale}</div>
    </div>
  );
}
