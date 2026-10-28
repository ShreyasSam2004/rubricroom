import { and, asc, desc, eq, sql } from "drizzle-orm";
import { checkUrl } from "@/lib/agents/proof";
import { JUDGE_ROLES, DEBATE_MODES, type DebateMode, type JudgeRole } from "@/lib/agents/roles";
import { debateTurn, HEURISTIC_LABELS, heuristicDebate, openingQuestion } from "@/lib/agents/verdict";
import { describeAIError, isAIConfigured } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { assessmentRevisions, debateSessions, debateTurns, ideaAssessments, ideaVersions, projectIdeas } from "@/lib/db/schema";
import { logActivity } from "@/lib/research/jobs";
import { WEIGHT_BASIS_LABEL } from "@/lib/scoring";
import { detectLanguage, hostOf, newId, truncate } from "@/lib/text";
import type { DebateClaim, IdeaUpdateProposal } from "@/lib/types";
import { applyCriterionChanges, assessCurrentVersion, buildVerdictContext, createVersion, currentVersion, getIdea, rubricContext } from "./ideas";

export type SessionRow = typeof debateSessions.$inferSelect;
export type TurnRow = typeof debateTurns.$inferSelect;

/**
 * Create a Judge's Room session. With an up-to-date AI assessment the room is ready at once. With
 * AI configured but no current assessment, the room opens straight away and `openDebate` (called
 * by the room) streams the opening question from the quick model while the full assessment runs
 * alongside. Offline, the rule-based assessment and opening are instant, so they happen here.
 */
export async function startDebate(workspaceId: string, opts: { ideaId: string; mode: DebateMode; focusCriterionId?: string | null; intensity?: number; track?: string | null; language?: "en" | "hi" | "hinglish" }) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, opts.ideaId);
  if (!idea) throw new Error("Idea not found");
  const version = await currentVersion(workspaceId, idea);
  let assessment = idea.latestAssessmentId ? (await db.select().from(ideaAssessments).where(eq(ideaAssessments.id, idea.latestAssessmentId)))[0] : null;
  const upgrade = Boolean(assessment && isAIConfigured() && assessment.method !== "ai");
  const stale = !assessment || assessment.ideaVersionId !== version.id || upgrade;
  let opening: { role: string; text: string } | null = stale ? null : (assessment?.opening ?? null);
  if (stale && !isAIConfigured()) {
    const res = await assessCurrentVersion(workspaceId, idea.id, { track: opts.track, reason: "Assessment for a new Judge's Room session." });
    assessment = res.assessment;
    opening = res.opening;
  }
  const ready = assessment && !(stale && isAIConfigured()) ? assessment : null;
  const sessionId = newId("deb");
  const [session] = await db
    .insert(debateSessions)
    .values({
      id: sessionId,
      workspaceId,
      ideaId: idea.id,
      hackathonId: idea.hackathonId,
      mode: opts.mode,
      focus: opts.focusCriterionId ?? null,
      intensity: Math.min(3, Math.max(1, opts.intensity ?? 2)),
      track: opts.track ?? null,
      language: opts.language ?? "en",
      outstandingConcerns: ready?.concerns ?? [],
      initialAssessmentId: ready?.id ?? null,
      currentAssessmentId: ready?.id ?? null,
    })
    .returning();
  if (ready) {
    const role = (opening?.role as JudgeRole) ?? "user_advocate";
    await db.insert(debateTurns).values({
      id: newId("turn"),
      sessionId,
      workspaceId,
      speaker: "judge",
      judgeRole: role,
      text: opening?.text ?? `${JUDGE_ROLES[role].question} Tell me who has this problem and how you know.`,
      method: ready.method,
    });
  }
  await logActivity(workspaceId, "debate", `Judge's Room opened for “${idea.name}” (${DEBATE_MODES[opts.mode].label})`, `/judge/${sessionId}`);
  return session;
}

export type OpenEvent =
  | { type: "step"; key: "opening" | "assessment"; status: "running" | "done" | "failed"; detail?: string }
  | { type: "opening"; role: string | null; text: string }
  | { type: "busy" };

/**
 * Finish opening a room: the opening question (quick model, streamed) and the full rubric
 * assessment, side by side. A lease on the session keeps two requests from doing it twice; the
 * room retries if this request is cut off, so nothing depends on one connection surviving.
 */
export async function openDebate(workspaceId: string, sessionId: string, emit: (e: OpenEvent) => void = () => undefined) {
  const db = await getDb();
  const [leased] = await db
    .update(debateSessions)
    .set({ openingUntil: sql`now() + interval '150 seconds'` })
    .where(and(eq(debateSessions.id, sessionId), eq(debateSessions.workspaceId, workspaceId), sql`(${debateSessions.openingUntil} is null or ${debateSessions.openingUntil} < now())`))
    .returning();
  if (!leased) {
    emit({ type: "busy" });
    return { busy: true };
  }
  try {
    const bundle = await getDebateBundle(workspaceId, sessionId);
    if (!bundle) throw new Error("Debate session not found");
    const { session, idea, version } = bundle;
    const tasks: Promise<void>[] = [];
    if (!bundle.turns.some((t) => t.speaker === "judge")) {
      tasks.push(
        (async () => {
          emit({ type: "step", key: "opening", status: "running" });
          const ctx = await buildVerdictContext(workspaceId, idea, version, { track: session.track, language: session.language as "en" | "hi" | "hinglish" });
          const o = await openingQuestion(ctx, {
            mode: session.mode as DebateMode,
            intensity: session.intensity,
            focusCriterionId: session.focus,
            onText: (role, text) => emit({ type: "opening", role, text }),
          });
          await db.insert(debateTurns).values({ id: newId("turn"), sessionId, workspaceId, speaker: "judge", judgeRole: o.role, text: o.text, method: o.method });
          emit({ type: "opening", role: o.role, text: o.text });
          emit({ type: "step", key: "opening", status: "done", detail: o.method === "ai" ? "Written by the quick model" : "Rule-based question" });
        })(),
      );
    }
    if (!session.currentAssessmentId) {
      tasks.push(
        (async () => {
          emit({ type: "step", key: "assessment", status: "running" });
          const { assessment } = await assessCurrentVersion(workspaceId, idea.id, {
            track: session.track,
            reason: "Assessment for a new Judge's Room session.",
            onProgress: (scored, total) => emit({ type: "step", key: "assessment", status: "running", detail: `${scored} of ${total} criteria scored` }),
          });
          await db
            .update(debateSessions)
            .set({ initialAssessmentId: assessment.id, currentAssessmentId: assessment.id, outstandingConcerns: assessment.concerns ?? [], updatedAt: new Date() })
            .where(eq(debateSessions.id, sessionId));
          const total = assessment.weightedTotal !== null ? `planning estimate ${assessment.weightedTotal}/100` : "scored";
          emit({ type: "step", key: "assessment", status: "done", detail: `${assessment.method === "ai" ? "Verdict (AI)" : "Rule-based"}, ${total}` });
        })(),
      );
    }
    const failed = (await Promise.allSettled(tasks)).find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    return { busy: false };
  } finally {
    await db.update(debateSessions).set({ openingUntil: null }).where(eq(debateSessions.id, sessionId));
  }
}

/** A turn can't be judged before the idea is scored: wait for the room's opening (or do it here). */
async function ensureOpened(workspaceId: string, sessionId: string, onStatus: (text: string) => void) {
  const db = await getDb();
  for (let i = 0; i < 150; i++) {
    const [s] = await db.select({ current: debateSessions.currentAssessmentId }).from(debateSessions).where(and(eq(debateSessions.id, sessionId), eq(debateSessions.workspaceId, workspaceId)));
    if (!s) throw new Error("Debate session not found");
    if (s.current) return;
    if (i === 0) onStatus("Waiting for the rubric scores to finish…");
    const { busy } = await openDebate(workspaceId, sessionId);
    if (busy) await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The idea is still being scored. Try again in a moment.");
}

export async function getDebateBundle(workspaceId: string, sessionId: string) {
  const db = await getDb();
  const [session] = await db.select().from(debateSessions).where(and(eq(debateSessions.id, sessionId), eq(debateSessions.workspaceId, workspaceId)));
  if (!session) return null;
  const [turns, idea] = await Promise.all([
    db.select().from(debateTurns).where(and(eq(debateTurns.sessionId, sessionId), eq(debateTurns.workspaceId, workspaceId))).orderBy(asc(debateTurns.createdAt)),
    getIdea(workspaceId, session.ideaId),
  ]);
  if (!idea) return null;
  const version = await currentVersion(workspaceId, idea);
  const [current] = session.currentAssessmentId ? await db.select().from(ideaAssessments).where(eq(ideaAssessments.id, session.currentAssessmentId)) : [];
  const [initial] = session.initialAssessmentId ? await db.select().from(ideaAssessments).where(eq(ideaAssessments.id, session.initialAssessmentId)) : [];
  const revisions = await db.select().from(assessmentRevisions).where(and(eq(assessmentRevisions.ideaId, idea.id), eq(assessmentRevisions.workspaceId, workspaceId))).orderBy(desc(assessmentRevisions.createdAt));
  const versions = await db.select().from(ideaVersions).where(and(eq(ideaVersions.ideaId, idea.id), eq(ideaVersions.workspaceId, workspaceId))).orderBy(desc(ideaVersions.version));
  return { session, turns, idea, version, versions, current: current ?? null, initial: initial ?? null, revisions: revisions.filter((r) => turns.some((t) => t.id === r.debateTurnId) || r.newAssessmentId === session.currentAssessmentId) };
}

export type TurnEvent = { type: "status"; text: string } | { type: "role"; role: string } | { type: "delta"; text: string } | { type: "reply"; text: string };

/**
 * One debate exchange. Evidence links are reachability-checked before the judge sees them.
 * `emit` streams progress and the judge's reply as it is written.
 */
export async function addDebateTurn(
  workspaceId: string,
  sessionId: string,
  opts: { text: string; request?: "harder" | "perspectives" | null; focusCriterionId?: string | null },
  emit: (e: TurnEvent) => void = () => undefined,
) {
  const db = await getDb();
  const text = opts.text.trim();
  if (!text && !opts.request) throw new Error("Say or type something for the judges.");
  let bundle = await getDebateBundle(workspaceId, sessionId);
  if (bundle && !bundle.current) {
    await ensureOpened(workspaceId, sessionId, (t) => emit({ type: "status", text: t }));
    bundle = await getDebateBundle(workspaceId, sessionId);
  }
  if (!bundle || !bundle.current) throw new Error("Debate session not found");
  const { session, idea, version, current } = bundle;

  const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s)>\]]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")))].slice(0, 3);
  if (urls.length) emit({ type: "status", text: `Checking ${urls.length === 1 ? "the link" : `${urls.length} links`} you gave…` });
  const checks = await Promise.all(urls.map(async (url) => ({ url, ...(await checkUrl(url)) })));
  const { hackathon } = await rubricContext(workspaceId, idea.hackathonId);
  const officialHost = hackathon?.officialUrl ? hostOf(hackathon.officialUrl) : null;
  const evidenceChecks = checks.map((c) => {
    const host = hostOf(c.url);
    const listing = /(^|\.)devpost\.com$/.test(host) && !/\/software\//.test(c.url);
    return { url: c.url, reachable: c.reachable, status: c.httpStatus, title: c.title, ownSite: Boolean(officialHost && (host === officialHost || host.endsWith(`.${officialHost}`))) || listing };
  });

  const ctx = await buildVerdictContext(workspaceId, idea, version, { track: session.track, language: session.language as "en" | "hi" | "hinglish" });
  const focus = opts.focusCriterionId ?? session.focus;
  const input = {
    ctx,
    mode: session.mode as DebateMode,
    intensity: opts.request === "harder" ? Math.min(3, session.intensity + 1) : session.intensity,
    focusCriterionId: focus,
    current: current.criterionResults,
    history: bundle.turns.map((t) => ({ speaker: t.speaker as "user" | "judge" | "system", role: t.judgeRole, text: t.text })),
    acceptedClaims: session.acceptedClaims,
    rejectedClaims: session.rejectedClaims,
    outstandingConcerns: session.outstandingConcerns,
    userText: text || (opts.request === "harder" ? "Ask me harder questions." : "Give me competing perspectives."),
    evidenceChecks,
    request: opts.request ?? null,
  };
  // Stream the reply: the role once chosen, then the text as deltas (a full "reply" if it restarts).
  let shownRole: string | null = null;
  let shown = "";
  const show = (role: string | null, reply: string) => {
    if (role && role !== shownRole) emit({ type: "role", role: (shownRole = role) });
    if (reply === shown) return;
    emit(reply.startsWith(shown) ? { type: "delta", text: reply.slice(shown.length) } : { type: "reply", text: reply });
    shown = reply;
  };
  emit({ type: "status", text: "The panel is weighing your answer against the rubric…" });
  let out: Awaited<ReturnType<typeof debateTurn>>;
  try {
    out = await debateTurn(input, { onReply: show });
  } catch (err) {
    out = heuristicDebate(input);
    out.reply = `Verdict (AI) was unavailable (${await describeAIError(err)}). This reply is from the rule-based judge.\n\n${out.reply}`;
  }
  show(out.role, out.reply);

  const userTurnId = newId("turn");
  await db.insert(debateTurns).values({
    id: userTurnId,
    sessionId,
    workspaceId,
    speaker: "user",
    text: text || (opts.request === "harder" ? "(Asked for harder questions)" : "(Asked for competing perspectives)"),
    claims: out.claims,
    method: out.method,
  });

  let revisionId: string | null = null;
  let newAssessmentId = current.id;
  if (out.changes.length) {
    const labels = new Map(out.claims.map((c) => [c.id, truncate(c.text, 120)]));
    const { assessment, revision } = await applyCriterionChanges(workspaceId, idea.id, current, out.changes, {
      reason: out.changes.map((c) => `${c.name}: ${c.from}→${c.to}. ${c.reason}`).join(" "),
      debateTurnId: userTurnId,
      claimLabels: labels,
    });
    revisionId = revision.id;
    newAssessmentId = assessment.id;
  }

  // First-hand experience accepted in the debate is also personal relevance (user-reported).
  const firstHand = out.claims.find((c) => c.status === "accepted" && c.kind === "user_reported" && c.criterionIds.length > 0 && /\b(i|i'm|i've|we|my|our|me)\b/i.test(c.text));
  if (firstHand && !idea.personalRelevance?.experiences) {
    await db.update(projectIdeas).set({ personalRelevance: { experiences: true, example: truncate(firstHand.text, 300) }, updatedAt: new Date() }).where(eq(projectIdeas.id, idea.id));
    const [asm] = await db.select().from(ideaAssessments).where(eq(ideaAssessments.id, newAssessmentId));
    if (asm) {
      const personalRelevance = { rating: 4, label: HEURISTIC_LABELS.personalRelevance, rationale: "User-reported first-hand experience, recorded in the Judge's Room." };
      await db.update(ideaAssessments).set({ heuristics: { ...asm.heuristics, personalRelevance } }).where(eq(ideaAssessments.id, newAssessmentId));
    }
  }

  const judgeTurnId = newId("turn");
  const [judgeTurn] = await db
    .insert(debateTurns)
    .values({
      id: judgeTurnId,
      sessionId,
      workspaceId,
      speaker: "judge",
      judgeRole: out.role,
      text: out.reply,
      revisionId,
      ideaUpdate: out.ideaUpdate ? { ...out.ideaUpdate, status: "proposed" as const } : null,
      method: out.method,
    })
    .returning();

  const accepted = [...session.acceptedClaims, ...out.claims.filter((c) => c.status === "accepted")];
  const rejected = [...session.rejectedClaims, ...out.claims.filter((c) => c.status === "rejected")];
  const concerns = [...session.outstandingConcerns.filter((c) => !out.concernsResolved.some((r) => r.toLowerCase().includes(c.toLowerCase().slice(0, 20)))), ...out.newConcerns].slice(-12);
  await db
    .update(debateSessions)
    .set({ acceptedClaims: accepted.slice(-40), rejectedClaims: rejected.slice(-40), outstandingConcerns: concerns, nextActions: out.nextActions.slice(0, 6), currentAssessmentId: newAssessmentId, updatedAt: new Date() })
    .where(eq(debateSessions.id, sessionId));
  return { judgeTurn, changes: out.changes, dropped: out.droppedChanges, claims: out.claims, method: out.method };
}

/** The user confirms (or dismisses) an idea correction the judge detected. Confirming creates a new version and reassesses. */
export async function resolveIdeaUpdate(workspaceId: string, turnId: string, action: "apply" | "dismiss") {
  const db = await getDb();
  const [turn] = await db.select().from(debateTurns).where(and(eq(debateTurns.id, turnId), eq(debateTurns.workspaceId, workspaceId)));
  if (!turn?.ideaUpdate || turn.ideaUpdate.status !== "proposed") throw new Error("No pending idea update on this turn.");
  const [session] = await db.select().from(debateSessions).where(eq(debateSessions.id, turn.sessionId));
  if (action === "dismiss") {
    await db.update(debateTurns).set({ ideaUpdate: { ...turn.ideaUpdate, status: "dismissed" } }).where(eq(debateTurns.id, turnId));
    return { applied: false };
  }
  const proposal: IdeaUpdateProposal = turn.ideaUpdate;
  const v = await createVersion(workspaceId, session.ideaId, {
    proposal,
    note: `From the Judge's Room: ${proposal.summary}`,
    source: "debate",
    influencedBy: [{ kind: "debate_claim", id: turnId, label: truncate(proposal.summary, 120) }],
  });
  const { assessment, revision } = await assessCurrentVersion(workspaceId, session.ideaId, {
    reason: `Idea updated to version ${v.version}: ${truncate(proposal.summary, 160)}`,
    debateTurnId: turnId,
    track: session.track,
    acceptedEvidence: session.acceptedClaims.map((c: DebateClaim) => c.text),
  });
  await db.update(debateTurns).set({ ideaUpdate: { ...proposal, status: "applied", versionId: v.versionId } }).where(eq(debateTurns.id, turnId));
  await db.update(debateSessions).set({ currentAssessmentId: assessment.id, updatedAt: new Date() }).where(eq(debateSessions.id, session.id));
  const changed = revision?.changes.length ? revision.changes.map((c) => `${c.name} ${c.from}→${c.to}`).join(", ") : "no rating changed";
  await db.insert(debateTurns).values({
    id: newId("turn"),
    sessionId: session.id,
    workspaceId,
    speaker: "system",
    text: `Idea updated to version ${v.version} and reassessed (${changed}).`,
    revisionId: revision?.id ?? null,
  });
  await logActivity(workspaceId, "idea", `Idea updated to v${v.version} from the Judge's Room`, `/ideas/${session.ideaId}`);
  return { applied: true, version: v.version, revision };
}

export async function exportDebateMarkdown(workspaceId: string, sessionId: string) {
  const b = await getDebateBundle(workspaceId, sessionId);
  if (!b) throw new Error("Debate not found");
  const lines: string[] = [];
  lines.push(`# Judge's Room — ${b.idea.name}`, "");
  lines.push(`Mode: ${DEBATE_MODES[b.session.mode as DebateMode]?.label ?? b.session.mode} · Started ${b.session.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, "");
  lines.push("> Simulated evaluation roles. AI-assisted planning estimates — not official scores and not a prediction of winning.", "");
  if (b.initial && b.current) {
    lines.push("## Assessment: start → now", "", `Weighting: ${WEIGHT_BASIS_LABEL[b.current.weightBasis]}`, "", "| Criterion | Weight | Start | Now |", "|---|---|---|---|");
    for (const r of b.current.criterionResults) {
      const s = b.initial.criterionResults.find((x) => x.criterionId === r.criterionId);
      lines.push(`| ${r.name} | ${r.weight ?? "—"} | ${s?.rating ?? "—"}/5 | ${r.rating}/5 |`);
    }
    lines.push("", `Weighted planning estimate: ${b.initial.weightedTotal ?? "—"} → ${b.current.weightedTotal ?? "—"} (of 100)`, "");
  }
  lines.push("## Transcript", "");
  for (const t of b.turns) {
    const who = t.speaker === "user" ? "**You**" : t.speaker === "judge" ? `**${JUDGE_ROLES[t.judgeRole as JudgeRole]?.label ?? "Judge"}**` : "_System_";
    lines.push(`${who}: ${t.text}`, "");
    for (const c of t.claims) lines.push(`- _${c.kind.replace("_", "-")} · ${c.status.replace("_", " ")}_: “${c.text}” — ${c.reason}`);
    if (t.claims.length) lines.push("");
  }
  lines.push("## Outstanding concerns", "", ...(b.session.outstandingConcerns.length ? b.session.outstandingConcerns.map((c) => `- ${c}`) : ["- none recorded"]), "");
  lines.push("## Next actions", "", ...(b.session.nextActions.length ? b.session.nextActions.map((c) => `- ${c}`) : ["- none"]), "");
  return lines.join("\n");
}

export function languageOf(text: string) {
  return detectLanguage(text);
}
