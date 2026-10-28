"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, Check, Download, Gavel, GitBranch, Hammer, Pencil, RefreshCw, Rocket, RotateCcw, Search, Undo2, Wand2, X } from "lucide-react";
import { JobProgress } from "@/components/research/job-progress";
import { AiProgress } from "@/components/ui/ai-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Badge, Callout, Input, Label, Textarea } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api, download } from "@/lib/client";
import type { IdeaFields, IdeaUpdateProposal } from "@/lib/types";

function useAction(ideaId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<{ name: string; since: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Runs one action and tracks it. `navigates` keeps the spinner up while the router moves on. */
  async function track<T>(name: string, fn: () => Promise<T>, opts: { navigates?: boolean } = {}) {
    setBusy({ name, since: Date.now() });
    setError(null);
    try {
      const r = await fn();
      if (!opts.navigates) setBusy(null);
      return r;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  function run<T>(name: string, body: Record<string, unknown>, after?: (r: T) => void) {
    return track(name, async () => {
      const r = await api<T>(`/api/ideas/${ideaId}`, body);
      after?.(r);
      router.refresh();
      return r;
    });
  }
  return { busy: busy?.name ?? null, since: busy?.since ?? null, error, run, track, router };
}

const TOOLBAR_PROGRESS: Record<string, { label: string; expected: string; detail?: string }> = {
  debate: { label: "Opening the Judge's Room", expected: "10–20 seconds", detail: "The panel reviews the latest assessment and prepares its first question." },
  assess: { label: "Verdict is reassessing this version against the rubric", expected: "10–15 seconds" },
  plan: { label: "Sprint is drafting your day-by-day plan", expected: "10–25 seconds", detail: "If the idea changed since its last feasibility check, Forge re-checks it first." },
};

export function IdeaToolbar({ ideaId, selected }: { ideaId: string; selected: boolean }) {
  const { busy, since, error, run, track, router } = useAction(ideaId);
  const progress = busy ? TOOLBAR_PROGRESS[busy] : undefined;
  const aiBusy = Boolean(progress);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          loading={busy === "debate"}
          disabled={aiBusy}
          onClick={() =>
            track(
              "debate",
              async () => {
                const { sessionId } = await api<{ sessionId: string }>("/api/debates", { ideaId, mode: "critical" });
                router.push(`/judge/${sessionId}`);
              },
              { navigates: true },
            )
          }
          data-testid="start-debate"
        >
          <Gavel /> Defend in the Judge&apos;s Room
        </Button>
        {selected ? (
          <Button variant="outline" loading={busy === "unselect"} onClick={() => run("unselect", { action: "unselect" })}>
            <Undo2 /> Reopen decision
          </Button>
        ) : (
          <Button variant="teal" loading={busy === "select"} onClick={() => run("select", { action: "select" })} data-testid="select-idea">
            <BadgeCheck /> Select as My Project
          </Button>
        )}
        <Button variant="outline" loading={busy === "assess"} disabled={aiBusy} onClick={() => run("assess", { action: "assess" })}>
          <RefreshCw /> Reassess
        </Button>
        <Button
          variant="outline"
          loading={busy === "plan"}
          disabled={aiBusy}
          onClick={() =>
            track(
              "plan",
              async () => {
                const { planId } = await api<{ planId: string }>("/api/plans", { action: "plan", ideaId });
                router.push(`/plan/${planId}`);
              },
              { navigates: true },
            )
          }
          data-testid="idea-create-plan"
        >
          <Hammer /> Create build plan
        </Button>
        <Button variant="ghost" onClick={() => download(`/api/ideas/${ideaId}?format=md`)} data-testid="export-brief">
          <Download /> Brief (.md)
        </Button>
        <Button variant="ghost" onClick={() => download(`/api/ideas/${ideaId}?format=json`)}>
          <Download /> JSON
        </Button>
      </div>
      {progress && since !== null && <AiProgress since={since} {...progress} />}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}

export function ResearchCompetitors({ ideaId, runningJobId, hasResults }: { ideaId: string; runningJobId: string | null; hasResults: boolean }) {
  const [jobId, setJobId] = useState<string | null>(runningJobId);
  const { busy, error, run } = useAction(ideaId);
  if (jobId) return <JobProgress jobId={jobId} title="Scout is researching existing projects" onDone={() => setJobId(null)} />;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant={hasResults ? "outline" : "default"} size="sm" loading={busy === "research"} onClick={() => run<{ jobId: string }>("research", { action: "research" }, (r) => setJobId(r.jobId))} data-testid="run-research">
        <Search /> {hasResults ? "Re-run competitor research" : "Research existing projects"}
      </Button>
      {error && <span className="text-xs text-coral">{error}</span>}
    </div>
  );
}

export function FeasibilityButton({ ideaId, has }: { ideaId: string; has: boolean }) {
  const { busy, since, error, run } = useAction(ideaId);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" loading={busy === "f"} onClick={() => run("f", { action: "feasibility" })}>
        <Rocket /> {has ? "Re-run Forge review" : "Run Forge feasibility review"}
      </Button>
      {busy === "f" && since !== null && <AiProgress since={since} label="Forge is reviewing scope, integrations and deadline risk" expected="8–15 seconds" />}
      {error && <span className="text-xs text-coral">{error}</span>}
    </div>
  );
}

export function PersonalRelevance({ ideaId, value }: { ideaId: string; value: { experiences: boolean | null; example: string } | null }) {
  const { busy, since, error, run } = useAction(ideaId);
  const [exp, setExp] = useState<boolean | null>(value?.experiences ?? null);
  const [example, setExample] = useState(value?.example ?? "");
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Is this a problem you, or someone you work with directly, actually have?</div>
      <div className="flex gap-2">
        {[
          [true, "Yes, I have it"],
          [false, "No"],
          [null, "Not sure"],
        ].map(([v, l]) => (
          <button key={String(v)} type="button" onClick={() => setExp(v as boolean | null)} className={`rounded-lg border px-3 py-1.5 text-sm ${exp === v ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted"}`}>
            {l as string}
          </button>
        ))}
      </div>
      <VoiceField value={example} onChange={setExample} rows={3} compact placeholder="A short real example: when it happened, what it cost you…" />
      <div className="flex items-center gap-2">
        <Button size="sm" loading={busy === "rel"} onClick={() => run("rel", { action: "relevance", experiences: exp, example })}>
          Save and reassess
        </Button>
        <span className="text-xs text-muted-foreground">Saved as user-reported, not independently verified evidence.</span>
      </div>
      {busy === "rel" && since !== null && <AiProgress since={since} label="Verdict is reassessing with your example" expected="10–15 seconds" />}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}

const FIELD_LABELS: { key: keyof IdeaFields; label: string; multiline?: boolean; list?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "summary", label: "Summary", multiline: true },
  { key: "userProblem", label: "Problem", multiline: true },
  { key: "targetAudience", label: "Target user" },
  { key: "workflow", label: "Core workflow", multiline: true },
  { key: "features", label: "Features (one per line)", list: true },
  { key: "differentiators", label: "Differentiators (one per line)", list: true },
  { key: "sponsorUsage", label: "Sponsor technology usage", multiline: true },
  { key: "techStack", label: "Tech stack (one per line)", list: true },
];

export function EditIdea({ ideaId, fields }: { ideaId: string; fields: IdeaFields }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELD_LABELS.map((f) => [f.key, f.list ? (fields[f.key] as string[]).join("\n") : (fields[f.key] as string)])));
  const [note, setNote] = useState("");
  const { busy, since, error, run } = useAction(ideaId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil /> Edit (new version)
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit idea" description="Saving creates a new immutable version and reassesses it." wide>
        <div className="grid gap-3 md:grid-cols-2">
          {FIELD_LABELS.map((f) => (
            <div key={f.key} className={f.multiline || f.list ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
              <Label>{f.label}</Label>
              {f.multiline || f.list ? (
                <Textarea rows={f.list ? 4 : 3} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              ) : (
                <Input value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="space-y-1.5 md:col-span-2">
            <Label>What changed and why (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Narrowed to one user after judge feedback" />
          </div>
        </div>
        {error && <Callout tone="danger" className="mt-3">{error}</Callout>}
        {busy === "edit" && since !== null && <AiProgress className="mt-3" since={since} label="Saving the new version and reassessing it" expected="10–15 seconds" />}
        <div className="mt-4 flex justify-end">
          <Button
            loading={busy === "edit"}
            onClick={() =>
              run(
                "edit",
                {
                  action: "edit",
                  note,
                  fields: Object.fromEntries(FIELD_LABELS.map((f) => [f.key, f.list ? draft[f.key].split("\n").map((s) => s.trim()).filter(Boolean) : draft[f.key]])),
                },
                () => setOpen(false),
              )
            }
          >
            Save as new version
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Voice feature refinement: dictate a change, review the proposal, confirm. */
export function DictateChange({ ideaId, initial = "" }: { ideaId: string; initial?: string }) {
  const [text, setText] = useState(initial);
  const [proposal, setProposal] = useState<{ proposal: IdeaUpdateProposal; method: string } | null>(null);
  const { busy, since, error, run } = useAction(ideaId);
  return (
    <div className="space-y-3" data-testid="dictate-change">
      <VoiceField value={text} onChange={setText} rows={3} onSubmit={() => run<{ proposal: IdeaUpdateProposal; method: string }>("propose", { action: "propose_change", instruction: text }, setProposal)} placeholder="“Remove the mobile application from the MVP and focus on the web dashboard.”" compact />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={busy === "propose"} disabled={text.trim().length < 3} onClick={() => run<{ proposal: IdeaUpdateProposal; method: string }>("propose", { action: "propose_change", instruction: text }, setProposal)}>
          <Wand2 /> Propose change
        </Button>
      </div>
      {busy === "propose" && since !== null && <AiProgress since={since} label="Prism is turning your instruction into a proposed change" expected="5–10 seconds" />}
      {busy === "apply" && since !== null && <AiProgress since={since} label="Creating the new version and reassessing it" expected="10–15 seconds" />}
      {error && <Callout tone="danger">{error}</Callout>}
      {proposal && (
        <div className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3 text-sm" data-testid="change-proposal">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{proposal.proposal.summary}</span>
            <Badge tone={proposal.method === "ai" ? "primary" : "gray"}>{proposal.method === "ai" ? "Prism (AI)" : "Rule-based"}</Badge>
          </div>
          {!!proposal.proposal.removedFeatures?.length && <div className="mt-1 text-coral">Remove: {proposal.proposal.removedFeatures.join(", ")}</div>}
          {!!proposal.proposal.addedFeatures?.length && <div className="mt-1 text-teal">Add: {proposal.proposal.addedFeatures.join(", ")}</div>}
          {Object.entries(proposal.proposal.changes).map(([k, v]) => (
            <div key={k} className="mt-1 text-muted-foreground">
              {k}: {Array.isArray(v) ? v.join(", ") : String(v)}
            </div>
          ))}
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy === "apply"} onClick={() => run("apply", { action: "apply_proposal", proposal: proposal.proposal }, () => { setProposal(null); setText(""); })} data-testid="confirm-change">
              <Check /> Confirm — create new version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              <X /> Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VersionActions({ ideaId, versionId, isCurrent }: { ideaId: string; versionId: string; isCurrent: boolean }) {
  const { busy, run, router } = useAction(ideaId);
  return (
    <div className="flex gap-1">
      {!isCurrent && (
        <Button variant="ghost" size="xs" loading={busy === "restore"} onClick={() => run("restore", { action: "restore", versionId })}>
          <RotateCcw /> Restore
        </Button>
      )}
      <Button variant="ghost" size="xs" loading={busy === "branch"} onClick={() => run<{ ideaId: string }>("branch", { action: "branch", versionId }, (r) => router.push(`/ideas/${r.ideaId}`))}>
        <GitBranch /> Branch
      </Button>
    </div>
  );
}

export function MergeFromVersion({ ideaId, versionId }: { ideaId: string; versionId: string }) {
  const { busy, run } = useAction(ideaId);
  const [fields, setFields] = useState<string[]>([]);
  const opts = ["features", "differentiators", "workflow", "userProblem", "targetAudience", "sponsorUsage"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opts.map((f) => (
        <label key={f} className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={fields.includes(f)} onChange={(e) => setFields(e.target.checked ? [...fields, f] : fields.filter((x) => x !== f))} />
          {f}
        </label>
      ))}
      <Button size="xs" variant="secondary" disabled={!fields.length} loading={busy === "merge"} onClick={() => run("merge", { action: "merge", fromVersionId: versionId, fields })}>
        Merge into current
      </Button>
    </div>
  );
}
