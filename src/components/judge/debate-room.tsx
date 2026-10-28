"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, CircleAlert, CircleCheck, CircleX, Download, Flame, Gavel, Loader2, MessagesSquare, Pencil, Square, Users, Volume2, VolumeX, X } from "lucide-react";
import { Delta, HeuristicPanel, RubricPanel } from "@/components/ideas/rubric-panel";
import { AiProgress } from "@/components/ui/ai-progress";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, CardContent, CardHeader, CardTitle, Select } from "@/components/ui/primitives";
import { Trace, type TraceStatus } from "@/components/ui/trace";
import { VoiceField, type VoiceFieldHandle } from "@/components/voice/voice-field";
import { api, download, streamApi } from "@/lib/client";
import { speech, useSpeech } from "@/lib/speech";
import { cn } from "@/lib/utils";
import type { CriterionChange, CriterionResult, DebateClaim, HeuristicDimensions, IdeaFields, IdeaUpdateProposal, WeightBasis } from "@/lib/types";

const ROLE: Record<string, { label: string; tone: string; question: string }> = {
  user_advocate: { label: "The User Advocate", tone: "bg-teal-soft text-teal", question: "Does someone genuinely need this?" },
  originality_skeptic: { label: "The Originality Skeptic", tone: "bg-primary-soft text-primary-soft-foreground", question: "How is this different from existing tools?" },
  engineering_judge: { label: "The Engineering Judge", tone: "bg-muted text-foreground", question: "Can this be built and demonstrated reliably?" },
  sponsor_judge: { label: "The Sponsor Judge", tone: "bg-amber-soft text-amber-foreground", question: "Is the required technology used meaningfully?" },
  demo_judge: { label: "The Demo Judge", tone: "bg-coral-soft text-coral", question: "Will I understand the value in two minutes?" },
};

const KIND_LABEL: Record<string, string> = { user_reported: "User-reported", verifiable: "Checkable claim", speculative: "Speculation", correction: "Correction", differentiator: "Differentiator" };

export interface DebateTurnView {
  id: string;
  speaker: "user" | "judge" | "system";
  judgeRole: string | null;
  text: string;
  claims: DebateClaim[];
  revisionChanges: CriterionChange[] | null;
  ideaUpdate: (IdeaUpdateProposal & { status: "proposed" | "applied" | "dismissed"; versionId?: string }) | null;
  method: string | null;
  createdAt: string;
}

export interface DebateRoomProps {
  sessionId: string;
  ideaId: string;
  ideaName: string;
  version: number;
  fields: IdeaFields;
  mode: string;
  intensity: number;
  focus: string | null;
  turns: DebateTurnView[];
  current: { results: CriterionResult[]; total: number | null; basis: WeightBasis; method: string; heuristics: HeuristicDimensions } | null;
  initial: { results: CriterionResult[]; total: number | null } | null;
  criteria: { id: string; name: string }[];
  accepted: DebateClaim[];
  rejected: DebateClaim[];
  concerns: string[];
  nextActions: string[];
  aiConfigured: boolean;
  hackathonName: string | null;
  /** The opening question or the rubric scores are still to come (the room writes them as it opens). */
  opening: boolean;
}

type OpenEvent = { type: "step"; key: "opening" | "assessment"; status: TraceStatus; detail?: string } | { type: "opening"; role: string | null; text: string } | { type: "busy" };
type TurnEvent = { type: "status"; text: string } | { type: "role"; role: string } | { type: "delta"; text: string } | { type: "reply"; text: string };

/** A judge reply being written: shown word by word until the saved turn arrives. */
interface Live {
  kind: "opening" | "turn";
  userText?: string;
  role: string | null;
  text: string;
  status: string | null;
  doneTurnId?: string;
}

interface StepState {
  status: TraceStatus;
  detail?: string;
  since?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-reply play/stop toggle. Disabled (with an explanation) while voices are muted. */
function ReadAloud({ id, text }: { id: string; text: string }) {
  const { supported, muted, speaking, currentId } = useSpeech();
  if (!supported) return null;
  const playing = speaking && currentId === id;
  return (
    <button
      type="button"
      onClick={() => (playing ? speech.stop() : speech.speak(text, id))}
      disabled={muted && !playing}
      className={cn("rounded p-0.5 disabled:cursor-not-allowed disabled:opacity-40", playing ? "text-coral" : "text-muted-foreground hover:text-foreground")}
      aria-label={playing ? "Stop reading this reply" : muted ? "Voices are muted" : "Read this reply aloud"}
      title={playing ? "Stop reading (Esc)" : muted ? "Voices are muted: unmute in the top bar" : "Read aloud"}
      data-testid="read-aloud"
      data-playing={playing ? "true" : "false"}
    >
      {playing ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-3.5" />}
    </button>
  );
}

function ClaimPill({ c }: { c: DebateClaim }) {
  const Icon = c.status === "accepted" ? CircleCheck : c.status === "rejected" ? CircleX : CircleAlert;
  return (
    <li className={cn("rounded-lg border p-2 text-xs", c.status === "accepted" ? "border-teal/30 bg-teal-soft/40" : c.status === "rejected" ? "border-coral/30 bg-coral-soft/40" : "border-amber/40 bg-amber-soft/40")} data-testid="claim">
      <div className="flex items-center gap-1.5 font-medium">
        <Icon className={cn("size-3.5", c.status === "accepted" ? "text-teal" : c.status === "rejected" ? "text-coral" : "text-amber-foreground")} />
        {KIND_LABEL[c.kind] ?? c.kind} · {c.status === "needs_evidence" ? "needs evidence" : c.status}
      </div>
      <div className="mt-1 text-foreground">“{c.text}”</div>
      <div className="mt-0.5 text-muted-foreground">{c.reason}</div>
    </li>
  );
}

export function DebateRoom(p: DebateRoomProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const hasOpening = p.turns.some((t) => t.speaker === "judge");
  const [steps, setSteps] = useState<Record<"opening" | "assessment", StepState>>({
    opening: { status: hasOpening ? "done" : "pending" },
    assessment: { status: p.current ? "done" : "pending" },
  });
  const [openError, setOpenError] = useState<string | null>(null);
  const openingRef = useRef(p.opening);
  const started = useRef(false);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(p.focus ?? "");
  const [tab, setTab] = useState<"idea" | "debate" | "rubric">("debate");
  const [isPending, startTransition] = useTransition();
  const voice = useSpeech();
  const field = useRef<VoiceFieldHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const lastJudgeId = useRef<string | null>(null);
  const follow = useRef(false);

  // While the room opens, `isPending` covers background refreshes, which must not lock the answer box.
  const thinking = busy || (isPending && !p.opening);
  const canAnswer = hasOpening || steps.opening.status === "done";
  useEffect(() => {
    openingRef.current = p.opening;
  }, [p.opening]);

  // Open the room: stream the opening question (quick model) while the idea is scored against the
  // rubric. If another tab is already doing it, keep refreshing until it is done.
  useEffect(() => {
    if (!p.opening || started.current) return;
    started.current = true;
    follow.current = true; // keep the question in view as it streams, above the answer box
    (async () => {
      for (let attempt = 0; attempt < 60 && openingRef.current; attempt++) {
        let busyElsewhere = false;
        try {
          await streamApi<OpenEvent>(`/api/debates/${p.sessionId}`, { action: "open" }, (e) => {
            if (e.type === "busy") busyElsewhere = true;
            else if (e.type === "opening") setLive((l) => ({ ...(l?.kind === "opening" ? l : {}), kind: "opening", role: e.role ?? l?.role ?? null, text: e.text, status: null }));
            else {
              setSteps((prev) => ({
                ...prev,
                [e.key]: { status: e.status, detail: e.detail ?? prev[e.key].detail, since: prev[e.key].since ?? (e.status === "running" ? Date.now() : undefined) },
              }));
              // The question is saved: show it and let the visitor answer while scoring finishes.
              if (e.key === "opening" && e.status === "done") startTransition(() => router.refresh());
            }
          });
          setOpenError(null);
        } catch (err) {
          setOpenError((err as Error).message);
        }
        startTransition(() => router.refresh());
        await sleep(busyElsewhere ? 2500 : 1500);
      }
    })();
  }, [p.opening, p.sessionId, router]);

  useEffect(() => {
    // The answer box sticks to the bottom of the screen; keep the newest message above it, not under it.
    if (bottom.current) bottom.current.style.scrollMarginBottom = `${(composer.current?.offsetHeight ?? 0) + 16}px`;
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    const lastJudge = [...p.turns].reverse().find((t) => t.speaker === "judge");
    if (lastJudge && lastJudge.id !== lastJudgeId.current) {
      // Auto-read only *new* replies, never on first load; `speech` itself refuses while muted.
      if (lastJudgeId.current && speech.getSnapshot().autoRead) speech.speak(lastJudge.text, lastJudge.id);
      lastJudgeId.current = lastJudge.id;
      if (!thinking) field.current?.focus(); // ready for the next Wispr answer
    }
  }, [p.turns, thinking]);

  async function send(request: "harder" | "perspectives" | null = null) {
    if (!text.trim() && !request) return;
    setBusy(true);
    setSentAt(Date.now());
    setError(null);
    follow.current = true;
    setLive({ kind: "turn", userText: text.trim() || (request === "harder" ? "Ask me harder questions." : "Give me competing perspectives."), role: null, text: "", status: null });
    try {
      // The reply streams in as the judge writes it; the saved turn (with claims) replaces it.
      const done = await streamApi<TurnEvent>(`/api/debates/${p.sessionId}`, { action: "turn", text, request, focusCriterionId: challenge || null }, (e) =>
        setLive((l) => {
          if (!l) return l;
          if (e.type === "status") return { ...l, status: e.text };
          if (e.type === "role") return { ...l, role: e.role };
          return { ...l, text: e.type === "delta" ? l.text + e.text : e.text };
        }),
      );
      setText("");
      setLive((l) => l && { ...l, doneTurnId: String(done.judgeTurnId) });
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
      setLive(null);
    } finally {
      setBusy(false);
      setSentAt(null);
    }
  }

  async function resolve(turnId: string, decision: "apply" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/debates/${p.sessionId}`, { action: "idea_update", turnId, decision });
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lastRevision = [...p.turns].reverse().find((t) => t.revisionChanges?.length)?.revisionChanges ?? null;
  // The streamed bubble gives way to the saved turn once the refreshed transcript has it.
  const shownLive = live && !(live.kind === "opening" ? hasOpening : live.doneTurnId && p.turns.some((t) => t.id === live.doneTurnId)) ? live : null;
  const liveRole = shownLive?.role ? ROLE[shownLive.role] : null;

  useEffect(() => {
    // Keep a streaming reply above the answer box as it grows, unless the reader scrolls up.
    if (!shownLive?.text || !follow.current || !bottom.current) return;
    bottom.current.style.scrollMarginBottom = `${(composer.current?.offsetHeight ?? 0) + 16}px`;
    bottom.current.scrollIntoView({ block: "end" });
  }, [shownLive?.text]);

  useEffect(() => {
    const stop = (e: WheelEvent | KeyboardEvent | TouchEvent) => {
      if (e instanceof WheelEvent ? e.deltaY < 0 : e instanceof KeyboardEvent ? ["PageUp", "ArrowUp", "Home"].includes(e.key) : true) follow.current = false;
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">Judge&apos;s Room{p.hackathonName ? ` · ${p.hackathonName}` : ""}</div>
          <h1 className="truncate text-xl font-semibold md:text-2xl" data-testid="debate-title">
            {p.ideaName} <span className="text-base font-normal text-muted-foreground">v{p.version}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline" className="capitalize">
            {p.mode} · intensity {p.intensity}
          </Badge>
          {!p.aiConfigured && <Badge tone="gray">Offline rule-based judge</Badge>}
          {voice.supported && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (voice.muted ? speech.setMuted(false) : speech.setAutoRead(!voice.autoRead))}
              aria-pressed={voice.autoRead && !voice.muted}
              title={voice.muted ? "All voices are muted. Click to unmute." : "Read new judge replies aloud (browser speech, separate from Wispr dictation)"}
              data-testid="auto-read"
            >
              {voice.muted ? <VolumeX className="text-coral" /> : <Volume2 className={voice.autoRead ? "text-primary" : ""} />}
              {voice.muted ? "Voices muted" : voice.autoRead ? "Read replies aloud: on" : "Read replies aloud: off"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => download(`/api/debates/${p.sessionId}?format=md`)} data-testid="export-debate">
            <Download /> Export summary
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border bg-card p-1 lg:hidden">
        {(["idea", "debate", "rubric"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("flex-1 rounded-md py-1.5 text-sm capitalize", tab === t ? "bg-primary-soft font-medium text-primary-soft-foreground" : "text-muted-foreground")}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Left: idea */}
        <aside className={cn("space-y-4", tab !== "idea" && "hidden lg:block")}>
          <Card>
            <CardHeader>
              <CardTitle>The idea</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="leading-relaxed">{p.fields.summary}</p>
              {p.fields.targetAudience && (
                <div>
                  <div className="text-xs text-muted-foreground">For</div>
                  <div>{p.fields.targetAudience}</div>
                </div>
              )}
              {p.fields.features.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground">Features</div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">{p.fields.features.map((f) => <li key={f}>{f}</li>)}</ul>
                </div>
              )}
              <a href={`/ideas/${p.ideaId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Pencil className="size-3" /> Edit pitch &amp; versions
              </a>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="size-4" /> The panel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              {Object.values(ROLE).map((r) => (
                <div key={r.label}>
                  <span className="font-medium text-foreground">{r.label}</span> — {r.question}
                </div>
              ))}
              <p className="pt-1">Simulated roles, not the real judges.</p>
            </CardContent>
          </Card>
        </aside>

        {/* Center: debate */}
        <section className={cn("flex min-w-0 flex-col gap-3", tab !== "debate" && "hidden lg:flex")}>
          <Card className="flex-1">
            <CardContent className="space-y-4 pt-5" data-testid="transcript">
              {p.opening && (
                <Trace
                  title="Opening the Judge's Room"
                  steps={[
                    {
                      key: "opening",
                      label: "Writing the opening question",
                      agent: "Verdict · quick model",
                      status: steps.opening.status,
                      detail: steps.opening.detail ?? (steps.opening.status === "running" ? "It appears below as it is written." : null),
                      since: steps.opening.since,
                    },
                    {
                      key: "assessment",
                      label: `Scoring the idea against the rubric${p.criteria.length ? ` (${p.criteria.length} criteria)` : ""}`,
                      agent: "Verdict",
                      status: steps.assessment.status,
                      detail: steps.assessment.detail ?? (steps.assessment.status === "running" ? "Runs alongside the question. You can start answering; the scores fill in on the right." : null),
                      since: steps.assessment.since,
                    },
                  ]}
                />
              )}
              {openError && <Callout tone="danger">Opening the room hit a problem: {openError} Retrying.</Callout>}
              {p.turns.map((t) => {
                if (t.speaker === "system") {
                  return (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      <Check className="size-3.5 text-teal" /> {t.text}
                    </div>
                  );
                }
                if (t.speaker === "user") {
                  return (
                    <div key={t.id} className="flex flex-col items-end gap-2" data-testid="user-turn">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">{t.text}</div>
                      {t.claims.length > 0 && <ul className="grid w-full max-w-[85%] gap-1.5">{t.claims.map((c) => <ClaimPill key={c.id} c={c} />)}</ul>}
                    </div>
                  );
                }
                const role = ROLE[t.judgeRole ?? "user_advocate"] ?? ROLE.user_advocate;
                return (
                  <div key={t.id} className="flex gap-3" data-testid="judge-turn">
                    <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", role.tone)}>
                      <Gavel className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{role.label}</span>
                        {t.method === "heuristic" && <Badge tone="gray">rule-based</Badge>}
                        <ReadAloud id={t.id} text={t.text} />
                      </div>
                      <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-[15px] leading-relaxed">{t.text}</div>
                      {t.revisionChanges && t.revisionChanges.length > 0 && (
                        <div className="flex flex-wrap gap-2" data-testid="revision">
                          {t.revisionChanges.map((c) => (
                            <span key={c.criterionId} className="inline-flex items-center gap-1.5 rounded-md bg-teal-soft px-2 py-1 text-xs">
                              {c.name} <Delta from={c.from} to={c.to} />
                            </span>
                          ))}
                        </div>
                      )}
                      {t.ideaUpdate?.status === "proposed" && (
                        <div className="rounded-xl border border-primary/30 bg-primary-soft/50 p-3 text-sm" data-testid="idea-update">
                          <div className="font-medium">Update the idea definition?</div>
                          <p className="mt-0.5 text-muted-foreground">{t.ideaUpdate.summary}</p>
                          {!!t.ideaUpdate.removedFeatures?.length && <p className="mt-1 text-coral">Remove: {t.ideaUpdate.removedFeatures.join(", ")}</p>}
                          {!!t.ideaUpdate.addedFeatures?.length && <p className="mt-1 text-teal">Add: {t.ideaUpdate.addedFeatures.join(", ")}</p>}
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" onClick={() => resolve(t.id, "apply")} loading={busy} data-testid="apply-update">
                              <Check /> Confirm: new version and reassess
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => resolve(t.id, "dismiss")}>
                              <X /> Keep current idea
                            </Button>
                          </div>
                        </div>
                      )}
                      {t.ideaUpdate?.status === "applied" && <Badge tone="teal">Idea updated</Badge>}
                    </div>
                  </div>
                );
              })}
              {shownLive?.userText && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/80 px-4 py-2.5 text-[15px] text-primary-foreground">{shownLive.userText}</div>
                </div>
              )}
              {shownLive?.text ? (
                <div className="flex gap-3" data-testid="judge-live" aria-live="polite">
                  <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", liveRole?.tone ?? "bg-muted text-foreground")}>
                    <Gavel className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium">{liveRole?.label ?? "The panel"}</span>
                      {!shownLive.doneTurnId && <span className="text-muted-foreground">is writing…</span>}
                    </div>
                    <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-[15px] leading-relaxed">
                      {shownLive.text}
                      {!shownLive.doneTurnId && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary/60 align-text-bottom" aria-hidden />}
                    </div>
                  </div>
                </div>
              ) : sentAt !== null ? (
                <AiProgress since={sentAt} label={shownLive?.status ?? "The panel is weighing your answer against the rubric"} detail="The reply appears here as it is written; claims are checked before any score moves." expected="a few seconds to start" className="max-w-md" />
              ) : (
                thinking &&
                !p.opening && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="judge-thinking">
                    <Loader2 className="size-4 animate-spin" /> The panel is weighing your answer against the rubric…
                  </div>
                )
              )}
              <div ref={bottom} />
            </CardContent>
          </Card>
          <div ref={composer} className="space-y-2 lg:sticky lg:bottom-3 lg:rounded-2xl lg:bg-background/90 lg:p-1 lg:backdrop-blur">
            <VoiceField
              ref={field}
              value={text}
              onChange={setText}
              onSubmit={() => send()}
              rows={4}
              disabled={thinking}
              placeholder="Answer the panel. Defend the idea, add a real example, paste a link to evidence, or correct a misunderstanding."
              data-testid="debate-input"
              className="shadow-lg"
            />
            {error && <Callout tone="danger">{error}</Callout>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => send()} loading={busy} disabled={!text.trim() || thinking || !canAnswer} data-testid="debate-send">
                <MessagesSquare /> Respond
              </Button>
              <Button variant="outline" size="sm" onClick={() => send("harder")} disabled={thinking || !canAnswer}>
                <Flame /> Harder questions
              </Button>
              <Button variant="outline" size="sm" onClick={() => send("perspectives")} disabled={thinking || !canAnswer}>
                <Users /> Competing perspectives
              </Button>
              <Select value={challenge} onChange={(e) => setChallenge(e.target.value)} className="h-8 w-auto max-w-56 text-xs" aria-label="Challenge a criterion">
                <option value="">Challenge: weakest criterion</option>
                {p.criteria.map((c) => (
                  <option key={c.id} value={c.id}>
                    Challenge: {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </section>

        {/* Right: live rubric */}
        <aside className={cn("space-y-4", tab !== "rubric" && "hidden lg:block")}>
          <Card>
            <CardHeader>
              <CardTitle>Live rubric assessment</CardTitle>
            </CardHeader>
            <CardContent>
              {p.current ? (
                <RubricPanel results={p.current.results} previous={p.initial?.results} total={p.current.total} previousTotal={p.initial?.total} basis={p.current.basis} method={p.current.method} compact />
              ) : p.opening ? (
                <div className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="rubric-scoring">
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                  <span>Verdict is scoring the idea against the rubric{steps.assessment.detail ? ` (${steps.assessment.detail})` : ""}. The scores appear here when it finishes.</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No assessment.</p>
              )}
              {lastRevision && (
                <div className="mt-3 rounded-lg border border-teal/30 bg-teal-soft/40 p-2.5 text-xs">
                  <div className="font-medium">Last change</div>
                  {lastRevision.map((c) => (
                    <div key={c.criterionId} className="mt-1">
                      {c.name}: {c.from}→{c.to}. <span className="text-muted-foreground">{c.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Evidence ledger</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div>
                <div className="mb-1 font-medium text-teal">Accepted ({p.accepted.length})</div>
                <ul className="space-y-1 text-muted-foreground">{p.accepted.length ? p.accepted.slice(-6).map((c) => <li key={c.id}>• {c.text}</li>) : <li>None yet</li>}</ul>
              </div>
              <div>
                <div className="mb-1 font-medium text-coral">Rejected ({p.rejected.length})</div>
                <ul className="space-y-1 text-muted-foreground">{p.rejected.length ? p.rejected.slice(-4).map((c) => <li key={c.id}>• {c.text}</li>) : <li>None</li>}</ul>
              </div>
              <div>
                <div className="mb-1 font-medium">Outstanding concerns</div>
                <ul className="space-y-1 text-muted-foreground">{p.concerns.length ? p.concerns.slice(-5).map((c, i) => <li key={i}>• {c}</li>) : <li>None recorded</li>}</ul>
              </div>
              {p.nextActions.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">Next actions</div>
                  <ul className="space-y-1 text-muted-foreground">{p.nextActions.map((c, i) => <li key={i}>→ {c}</li>)}</ul>
                </div>
              )}
            </CardContent>
          </Card>
          {p.current && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Beyond the rubric</CardTitle>
              </CardHeader>
              <CardContent>
                <HeuristicPanel heuristics={p.current.heuristics} />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
