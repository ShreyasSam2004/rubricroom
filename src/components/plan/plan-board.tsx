"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Circle, CircleDot, Clapperboard, Download, Link2, Plus, RefreshCw, StickyNote, Trash2, Wand2, X } from "lucide-react";
import { AiProgress } from "@/components/ui/ai-progress";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui/primitives";
import { VoiceField } from "@/components/voice/voice-field";
import { api, download } from "@/lib/client";
import { tokenize } from "@/lib/text-client";
import { cn } from "@/lib/utils";
import type { DemoSegment, PlanDay } from "@/lib/types";

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  day: number;
  tier: string;
  priority: string;
  status: string;
  acceptance: string | null;
  notes: string | null;
  proofUrl: string | null;
  estimateHours: number | null;
  dependsOn: string[];
}

const STATUS_CYCLE: Record<string, string> = { todo: "doing", doing: "done", done: "todo", blocked: "todo", cut: "todo" };

function StatusIcon({ s }: { s: string }) {
  if (s === "done") return <Check className="size-4 text-teal" />;
  if (s === "doing") return <CircleDot className="size-4 text-primary" />;
  if (s === "cut") return <X className="size-4 text-muted-foreground" />;
  return <Circle className="size-4 text-muted-foreground" />;
}

export function PlanBoard({ planId, ideaId, days, tasks, pendingTask }: { planId: string; ideaId: string; days: PlanDay[]; tasks: TaskView[]; pendingTask: { query: string; status: string } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDay, setNewDay] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const match = useMemo(() => {
    if (!pendingTask?.query) return null;
    const q = new Set(tokenize(pendingTask.query));
    let best: TaskView | null = null;
    let bestScore = 0;
    for (const t of tasks) {
      const toks = tokenize(t.title);
      const s = toks.filter((x) => q.has(x)).length / Math.max(1, Math.min(q.size, toks.length));
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return bestScore >= 0.34 ? best : null;
  }, [pendingTask, tasks]);

  async function patch(taskId: string, body: Record<string, unknown>) {
    setBusy(taskId);
    setError(null);
    try {
      await api(`/api/plans/${planId}`, { action: "update_task", taskId, ...body });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const coreTasks = tasks.filter((t) => t.tier !== "optional");
  const done = coreTasks.filter((t) => t.status === "done").length;

  return (
    <div className="space-y-4" data-testid="plan-board">
      {pendingTask && (
        <Callout tone="info" title={match ? `Mark “${match.title}” as ${pendingTask.status}?` : `No task matches “${pendingTask.query}”`}>
          {match && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await patch(match.id, { status: pendingTask.status });
                  router.replace(`/plan/${planId}`);
                }}
              >
                <Check /> Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => router.replace(`/plan/${planId}`)}>
                Cancel
              </Button>
            </div>
          )}
        </Callout>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-semibold">{done}</span> of {coreTasks.length} core &amp; strong-demo tasks done
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => download(`/api/plans/${planId}?format=md`)} data-testid="export-plan">
            <Download /> Markdown
          </Button>
          <Button variant="outline" size="sm" onClick={() => download(`/api/plans/${planId}?format=json`)}>
            <Download /> JSON
          </Button>
        </div>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="scrollbar-thin -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const list = tasks.filter((t) => t.day === d.day);
          const hours = list.filter((t) => t.status !== "cut").reduce((s, t) => s + (t.estimateHours ?? 0), 0);
          return (
            <div key={d.day} className="w-[300px] shrink-0 snap-start rounded-xl border bg-card" data-testid="plan-day">
              <div className="border-b p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Day {d.day}</span>
                  <span>
                    {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · ~{d.hours}h {hours > d.hours + 0.5 && <span className="text-coral">({hours}h planned)</span>}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium leading-snug">{d.goal}</div>
                <div className="mt-1 text-xs text-muted-foreground">Artifact: {d.artifact}</div>
              </div>
              <ul className="space-y-1.5 p-2">
                {list.map((t) => (
                  <li key={t.id} className={cn("rounded-lg border p-2", t.status === "done" && "bg-teal-soft/40", t.status === "cut" && "opacity-50", match?.id === t.id && "ring-2 ring-primary")} data-testid="task">
                    <div className="flex items-start gap-2">
                      <button type="button" disabled={busy === t.id} onClick={() => patch(t.id, { status: STATUS_CYCLE[t.status] ?? "todo" })} className="mt-0.5 shrink-0" aria-label={`Status: ${t.status}. Click to change.`} data-testid="task-toggle">
                        <StatusIcon s={t.status} />
                      </button>
                      <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} className="min-w-0 flex-1 text-left">
                        <div className={cn("text-[13px] leading-snug", t.status === "done" && "line-through decoration-teal/60")}>{t.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.tier !== "core" && <Badge tone={t.tier === "strong" ? "primary" : "gray"}>{t.tier === "strong" ? "Strong demo" : "Optional"}</Badge>}
                          {t.priority === "high" && t.tier === "core" && <Badge tone="coral">High</Badge>}
                          {t.estimateHours ? <Badge tone="outline">~{t.estimateHours}h</Badge> : null}
                          {t.proofUrl && (
                            <Badge tone="teal">
                              <Link2 /> proof
                            </Badge>
                          )}
                        </div>
                      </button>
                    </div>
                    {open === t.id && <TaskDetails t={t} onSave={(body) => patch(t.id, body)} onDelete={async () => { await api(`/api/plans/${planId}`, { action: "delete_task", taskId: t.id }); router.refresh(); }} />}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a task…" className="h-9 max-w-sm" />
        <Select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))} className="h-9 w-28">
          {days.map((d) => (
            <option key={d.day} value={d.day}>
              Day {d.day}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          disabled={newTitle.trim().length < 2}
          onClick={async () => {
            await api(`/api/plans/${planId}`, { action: "add_task", title: newTitle, day: newDay });
            setNewTitle("");
            router.refresh();
          }}
        >
          <Plus /> Add
        </Button>
        <Replan ideaId={ideaId} />
      </div>
    </div>
  );
}

function TaskDetails({ t, onSave, onDelete }: { t: TaskView; onSave: (b: Record<string, unknown>) => void; onDelete: () => void }) {
  const [notes, setNotes] = useState(t.notes ?? "");
  const [proof, setProof] = useState(t.proofUrl ?? "");
  const [priority, setPriority] = useState(t.priority);
  return (
    <div className="mt-2 space-y-2 border-t pt-2 text-xs">
      {t.description && <p className="text-muted-foreground">{t.description}</p>}
      {t.acceptance && <p>✓ Done when: {t.acceptance}</p>}
      <div className="flex items-center gap-1.5">
        <StickyNote className="size-3.5 text-muted-foreground" />
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="h-7 text-xs" />
      </div>
      <div className="flex items-center gap-1.5">
        <Link2 className="size-3.5 text-muted-foreground" />
        <Input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Proof link (commit, deploy, video)" className="h-7 text-xs" />
      </div>
      <div className="flex items-center gap-1.5">
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-7 w-24 text-xs">
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Button size="xs" onClick={() => onSave({ notes, proofUrl: proof, priority })}>
          Save
        </Button>
        <Button size="xs" variant="ghost" onClick={() => onSave({ status: "cut" })}>
          Cut from scope
        </Button>
        <Button size="xs" variant="ghost" onClick={onDelete} aria-label="Delete task">
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function Replan({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("");
  const [since, setSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
        <RefreshCw /> Replan
      </Button>
    );
  return (
    <div className="w-full space-y-2 rounded-xl border p-3">
      <VoiceField value={scope} onChange={setScope} rows={2} compact placeholder="Optional scope change, e.g. “Remove the mobile application from the MVP and focus on the web dashboard.”" />
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={since !== null}
          onClick={async () => {
            setSince(Date.now());
            setError(null);
            try {
              const { planId } = await api<{ planId: string }>("/api/plans", { action: "plan", ideaId, scopeChange: scope || null });
              router.push(`/plan/${planId}`);
            } catch (e) {
              setError((e as Error).message);
              setSince(null);
            }
          }}
          data-testid="replan-submit"
        >
          Create new plan from the current idea version
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={since !== null}>
          Cancel
        </Button>
      </div>
      {since !== null && <AiProgress since={since} label="Sprint is re-planning from the current idea version" expected="10–25 seconds" />}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}

export interface DemoView {
  hook: string;
  segments: DemoSegment[];
  closing: string;
  checklist: string[];
  excludedFeatures: string[];
  refinements: string[];
  method: string;
  timeLimitSec: number;
}

export function DemoStrategy({ ideaId, demo, defaultLimit }: { ideaId: string; demo: DemoView | null; defaultLimit: number }) {
  const router = useRouter();
  const [refine, setRefine] = useState("");
  const [limit, setLimit] = useState(demo?.timeLimitSec ?? defaultLimit);
  const [since, setSince] = useState<number | null>(null);
  const busy = since !== null;
  const [error, setError] = useState<string | null>(null);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  async function generate(refinement: string | null) {
    setSince(Date.now());
    setError(null);
    try {
      await api("/api/plans", { action: "demo", ideaId, timeLimitSec: limit, refinement });
      setRefine("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSince(null);
    }
  }
  return (
    <Card id="demo">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clapperboard className="size-4 text-coral" /> Demo strategy
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Built only from features marked done, so the script never shows something you haven&apos;t built.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-8 w-28 text-xs" aria-label="Video time limit">
            {[60, 90, 120, 180, 300].map((s) => (
              <option key={s} value={s}>
                {fmt(s)} limit
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => generate(null)} loading={busy} data-testid="demo-generate">
            {demo ? "Regenerate" : "Generate script"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {since !== null && <AiProgress since={since} label="Sprint is writing the demo script from the features you've marked done" expected="8–15 seconds" />}
        {error && <Callout tone="danger">{error}</Callout>}
        {demo ? (
          <>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Opening hook · </span>
              {demo.hook}
            </div>
            <ol className="space-y-2" data-testid="demo-segments">
              {demo.segments.map((s, i) => (
                <li key={i} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[90px_1fr]">
                  <div className="font-mono text-xs text-muted-foreground">
                    {fmt(s.start)}–{fmt(s.end)}
                  </div>
                  <div>
                    <div className="font-medium">{s.title}</div>
                    <div className="mt-0.5">“{s.narration}”</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">On screen: {s.onScreen}</div>
                    {s.basedOn.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{s.basedOn.map((b) => <Badge key={b} tone="teal">{b}</Badge>)}</div>}
                  </div>
                </li>
              ))}
            </ol>
            <div className="text-sm">
              <span className="text-xs font-medium text-muted-foreground">Closing · </span>
              {demo.closing}
            </div>
            {demo.excludedFeatures.length > 0 && <Callout tone="warning" title="Not shown (not built yet)">{demo.excludedFeatures.join(", ")}</Callout>}
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Recording checklist</div>
              <ul className="space-y-1 text-sm">
                {demo.checklist.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-teal" /> {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2 border-t pt-3">
              <VoiceField value={refine} onChange={setRefine} rows={2} compact onSubmit={() => generate(refine)} placeholder="Refine by voice: “Make the demo understandable to nontechnical judges” · “Shorten the first 20 seconds” · “Focus more on the voice debate”" />
              <Button size="sm" variant="secondary" disabled={!refine.trim()} loading={busy} onClick={() => generate(refine)}>
                <Wand2 /> Refine script
              </Button>
              {demo.refinements.length > 0 && <p className="text-xs text-muted-foreground">Applied so far: {demo.refinements.join(" · ")}</p>}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No script yet. Mark the features you&apos;ve built as done, then generate.</p>
        )}
      </CardContent>
    </Card>
  );
}
