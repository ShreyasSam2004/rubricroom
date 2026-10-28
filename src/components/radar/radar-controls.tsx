"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookmarkPlus, ExternalLink, Radar, Sparkles } from "lucide-react";
import { JobProgress } from "@/components/research/job-progress";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Label, Select } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { OpportunityCard } from "@/lib/types";

const MODES = [
  ["unsolved", "Unsolved problems", "Practical problems people describe again and again in public."],
  ["overcrowded", "Overcrowded areas", "Categories with lots of existing builds, measured on GitHub."],
  ["underserved", "Underserved users", "Groups that hackathon projects tend to overlook."],
  ["sponsor", "Sponsor opportunity", "What the sponsor technology uniquely enables."],
  ["combinations", "Unexpected combinations", "Coherent new concepts: neglected problems × capabilities."],
  ["alternative", "Alternative to my idea", "Substantially different directions to an idea you already have."],
] as const;

const MODIFIERS = [
  ["more", "Generate more"],
  ["ambitious", "More technically ambitious"],
  ["impact", "More human impact"],
  ["less_crowded", "Less crowded"],
  ["easier", "Easier to build"],
  ["sponsor", "Better sponsor integration"],
  ["visual", "More visual demo"],
  ["commercial", "More commercially viable"],
] as const;

export function RadarControls({ hackathons, ideas, defaultHackathonId, defaultBaseId, jobId: initialJob, aiConfigured }: { hackathons: { id: string; name: string }[]; ideas: { id: string; name: string }[]; defaultHackathonId: string | null; defaultBaseId: string | null; jobId: string | null; aiConfigured: boolean }) {
  const router = useRouter();
  const [hackathonId, setHackathonId] = useState(defaultHackathonId ?? "");
  const [mode, setMode] = useState<string>(defaultBaseId ? "alternative" : "unsolved");
  const [mods, setMods] = useState<string[]>([]);
  const [request, setRequest] = useState("");
  const [baseId, setBaseId] = useState(defaultBaseId ?? ideas[0]?.id ?? "");
  const [jobId, setJobId] = useState<string | null>(initialJob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ jobId: string }>("/api/opportunities", { action: "generate", hackathonId: hackathonId || null, mode, modifiers: mods, request: request || null, baseIdeaId: mode === "alternative" ? baseId || null : null, count: mods.includes("more") ? 7 : 5 });
      setJobId(r.jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (jobId)
    return (
      <JobProgress
        jobId={jobId}
        title="Nova is exploring opportunities"
        onDone={() => {
          setJobId(null);
          router.replace("/radar");
        }}
      />
    );

  return (
    <div className="space-y-5" data-testid="radar-controls">
      {!aiConfigured && (
        <Callout tone="warning" icon={<Radar />} title="Signals only (no AI provider configured)">
          Nova needs an AI provider to propose concepts. Without one, RubricRoom still gathers real signals (Hacker News pain points, GitHub crowding counts, the organizer&apos;s example ideas) so you can explore by hand.
        </Callout>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map(([k, l, d]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={cn("rounded-xl border p-3 text-left", mode === k ? "border-primary bg-primary-soft/60" : "hover:bg-muted")} data-testid={`radar-mode-${k}`}>
            <div className="text-sm font-medium">{l}</div>
            <div className="text-xs text-muted-foreground">{d}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MODIFIERS.map(([k, l]) => {
          const on = mods.includes(k);
          return (
            <button key={k} type="button" onClick={() => setMods(on ? mods.filter((m) => m !== k) : [...mods, k])} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")} aria-pressed={on}>
              {l}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Hackathon</Label>
          <Select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)}>
            <option value="">None</option>
            {hackathons.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </div>
        {mode === "alternative" && (
          <div className="space-y-1.5">
            <Label>Find something better than</Label>
            <Select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
              {ideas.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <VoiceField value={request} onChange={setRequest} rows={3} onSubmit={generate} placeholder="Optional, by voice: “Give me something less crowded and easier to build, but with more human impact.”" compact data-testid="radar-request" />
      {error && <Callout tone="danger">{error}</Callout>}
      <Button onClick={generate} loading={busy} data-testid="radar-generate">
        <Sparkles /> {aiConfigured ? "Explore opportunities" : "Gather signals"}
      </Button>
    </div>
  );
}

export function OpportunityCardView({ card, setId, index }: { card: OpportunityCard; setId: string; index: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <article className="flex flex-col rounded-xl border bg-card p-5" data-testid="opportunity-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{card.name}</h3>
          <p className="text-sm text-muted-foreground">{card.pitch}</p>
        </div>
        <Badge tone={card.feasibility === "high" ? "teal" : card.feasibility === "medium" ? "amber" : "coral"}>{card.feasibility} feasibility</Badge>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Target user</dt>
          <dd>{card.targetUser}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Real problem</dt>
          <dd>{card.problem}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">How it works</dt>
          <dd>{card.howItWorks}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Memorable demo moment</dt>
          <dd>{card.demoMoment}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Why it&apos;s different</dt>
          <dd>{card.differentiation}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Sponsor integration</dt>
          <dd>{card.sponsorIntegration}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">MVP scope</dt>
          <dd>
            <ul className="list-inside list-disc">{card.mvpScope.map((m) => <li key={m}>{m}</li>)}</ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Risks</dt>
          <dd>
            <ul className="list-inside list-disc">{card.risks.map((m) => <li key={m}>{m}</li>)}</ul>
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-2 text-xs">
        <div className="font-medium">Problem evidence</div>
        <ul className="space-y-1">
          {card.problemEvidence.map((e, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Badge tone={e.observed ? "teal" : "gray"}>{e.observed ? "Observed" : "Assumption"}</Badge>
              {e.url ? (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                  {e.label} <ExternalLink className="inline size-3" />
                </a>
              ) : (
                <span className="text-muted-foreground">{e.label}</span>
              )}
            </li>
          ))}
        </ul>
        {card.assumptions.length > 0 && <div className="text-muted-foreground">Unverified assumptions: {card.assumptions.join("; ")}</div>}
      </div>
      <div className="mt-auto flex justify-end pt-4">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { ideaId } = await api<{ ideaId: string }>("/api/opportunities", { action: "save", setId, index });
              router.push(`/ideas/${ideaId}`);
            } catch (e) {
              alert((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <BookmarkPlus /> Save to My Ideas
        </Button>
      </div>
    </article>
  );
}
