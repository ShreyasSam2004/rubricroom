// Durable, step-driven research jobs. Each HTTP request advances exactly one bounded step and
// persists the result, so jobs survive serverless instance restarts and never depend on an
// in-memory promise outliving its request. A lease lock prevents two requests running a step.

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { activityLog, researchJobs } from "@/lib/db/schema";
import { researchBudget } from "@/lib/env";
import { newId } from "@/lib/text";
import type { AgentName, CoverageItem, JobStatus, JobStep, JobType, StepStatus } from "@/lib/types";

export type JobRow = typeof researchJobs.$inferSelect;

export interface StepContext {
  job: JobRow;
  workspaceId: string;
  state: Record<string, unknown>;
  /** Spend from the job's research budget; returns false (and spends nothing) when exhausted. */
  spend: (kind: keyof typeof researchBudget, amount?: number) => boolean;
  remaining: (kind: keyof typeof researchBudget) => number;
  /** Report what a long step has done so far; saved (at most every 1.5 s) where the trace reads it. */
  progress: (detail: string) => void;
}

export interface StepResult {
  status: StepStatus;
  detail?: string;
  counts?: Record<string, number>;
  coverage?: CoverageItem[];
  /** A failed critical step fails the whole job. */
  fatal?: boolean;
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;

export interface StepTemplate {
  key: string;
  label: string;
  agent: AgentName;
  phase: JobStatus;
}

const registry = new Map<JobType, { steps: StepTemplate[]; handlers: Record<string, StepHandler>; onFinish?: (job: JobRow) => Promise<void> }>();

export function registerJobType(type: JobType, steps: StepTemplate[], handlers: Record<string, StepHandler>, onFinish?: (job: JobRow) => Promise<void>) {
  registry.set(type, { steps, handlers, onFinish });
}

async function ensureRegistered() {
  if (registry.size) return;
  await Promise.all([import("./steps/event"), import("./steps/idea"), import("./steps/opportunities")]);
}

export async function createJob(opts: { workspaceId: string; jobType: JobType; hackathonId?: string | null; ideaId?: string | null; input?: Record<string, unknown> }): Promise<JobRow> {
  await ensureRegistered();
  const def = registry.get(opts.jobType);
  if (!def) throw new Error(`Unknown job type ${opts.jobType}`);
  const db = await getDb();
  const [row] = await db
    .insert(researchJobs)
    .values({
      id: newId("job"),
      workspaceId: opts.workspaceId,
      hackathonId: opts.hackathonId ?? null,
      ideaId: opts.ideaId ?? null,
      jobType: opts.jobType,
      status: "queued",
      input: opts.input ?? {},
      steps: def.steps.map((s) => ({ key: s.key, label: s.label, agent: s.agent, status: "pending" as StepStatus })),
      state: {},
      budget: {},
      coverage: [],
    })
    .returning();
  return row;
}

export async function getJob(workspaceId: string, jobId: string) {
  const db = await getDb();
  const rows = await db.select().from(researchJobs).where(and(eq(researchJobs.id, jobId), eq(researchJobs.workspaceId, workspaceId)));
  return rows[0] ?? null;
}

const TERMINAL: JobStatus[] = ["complete", "partial", "failed"];

export function isTerminal(status: string) {
  return (TERMINAL as string[]).includes(status);
}

function mergeCoverage(existing: CoverageItem[], incoming: CoverageItem[] = []) {
  const map = new Map(existing.map((c) => [c.key, c]));
  for (const c of incoming) map.set(c.key, c);
  return [...map.values()];
}

/** Run the next pending step of a job (if no other request holds the lease) and return the job. */
export async function advanceJob(workspaceId: string, jobId: string): Promise<JobRow | null> {
  await ensureRegistered();
  const db = await getDb();
  const leased = await db
    .update(researchJobs)
    .set({ lockedUntil: sql`now() + interval '330 seconds'` })
    .where(
      and(
        eq(researchJobs.id, jobId),
        eq(researchJobs.workspaceId, workspaceId),
        sql`(${researchJobs.lockedUntil} is null or ${researchJobs.lockedUntil} < now())`,
        sql`${researchJobs.status} not in ('complete','partial','failed')`,
      ),
    )
    .returning();
  const job = leased[0];
  if (!job) return getJob(workspaceId, jobId);

  const def = registry.get(job.jobType as JobType)!;
  const steps: JobStep[] = job.steps.map((s) => ({ ...s }));
  const state: Record<string, unknown> = { ...job.state };
  const budget: Record<string, number> = { ...job.budget };
  const startedAt = job.startedAt ?? new Date();

  // Overall time budget: stop gracefully with partial results.
  if (Date.now() - startedAt.getTime() > researchBudget.maxJobMs) {
    for (const s of steps) if (s.status === "pending" || s.status === "running") Object.assign(s, { status: "budget_exhausted", detail: "Job time budget reached; returning partial results." });
    return finish(job, steps, state, budget, job.coverage, startedAt, def.onFinish);
  }

  const idx = steps.findIndex((s) => s.status === "pending" || (s.status === "running" && (s.attempts ?? 0) < 2));
  if (idx === -1) return finish(job, steps, state, budget, job.coverage, startedAt, def.onFinish);

  const step = steps[idx];
  const template = def.steps.find((t) => t.key === step.key)!;
  Object.assign(step, { status: "running", startedAt: new Date().toISOString(), attempts: (step.attempts ?? 0) + 1 });
  await db
    .update(researchJobs)
    .set({ steps, status: template.phase, startedAt, updatedAt: new Date() })
    .where(eq(researchJobs.id, job.id));

  // Progress writes go out one at a time and stop before the step's result is saved, so a late
  // write can never put a finished step back to "running".
  let lastProgress = 0;
  let writing: Promise<unknown> | null = null;
  let stepOpen = true;
  const progress = (detail: string) => {
    if (!stepOpen || writing || Date.now() - lastProgress < 1500) return;
    lastProgress = Date.now();
    step.detail = detail;
    writing = db
      .update(researchJobs)
      .set({ steps, updatedAt: new Date() })
      .where(eq(researchJobs.id, job.id))
      .catch(() => undefined)
      .finally(() => {
        writing = null;
      });
  };

  const ctx: StepContext = {
    job: { ...job, steps, state },
    workspaceId,
    state,
    spend: (kind, amount = 1) => {
      const used = budget[kind] ?? 0;
      if (used + amount > researchBudget[kind]) return false;
      budget[kind] = used + amount;
      return true;
    },
    remaining: (kind) => researchBudget[kind] - (budget[kind] ?? 0),
    progress,
  };

  let result: StepResult;
  try {
    result = await def.handlers[step.key](ctx);
  } catch (err) {
    result = { status: "failed", detail: `Step error: ${(err as Error).message ?? String(err)}`.slice(0, 600) };
  }
  stepOpen = false;
  await writing;
  Object.assign(step, { status: result.status, detail: result.detail, counts: result.counts, finishedAt: new Date().toISOString() });
  const coverage = mergeCoverage(job.coverage, result.coverage);

  if (result.fatal && result.status === "failed") {
    for (const s of steps) if (s.status === "pending") Object.assign(s, { status: "skipped", detail: "Skipped because an earlier required step failed." });
    return finish(job, steps, state, budget, coverage, startedAt, def.onFinish, result.detail);
  }
  const more = steps.some((s) => s.status === "pending");
  if (!more) return finish(job, steps, state, budget, coverage, startedAt, def.onFinish);

  const [updated] = await db
    .update(researchJobs)
    .set({ steps, state, budget, coverage, lockedUntil: null, updatedAt: new Date() })
    .where(eq(researchJobs.id, job.id))
    .returning();
  return updated;
}

async function finish(
  job: JobRow,
  steps: JobStep[],
  state: Record<string, unknown>,
  budget: Record<string, number>,
  coverage: CoverageItem[],
  startedAt: Date,
  onFinish?: (job: JobRow) => Promise<void>,
  fatalError?: string,
) {
  const db = await getDb();
  const degraded = steps.some((s) => ["failed", "not_configured", "budget_exhausted", "skipped"].includes(s.status));
  const status: JobStatus = fatalError ? "failed" : degraded ? "partial" : "complete";
  const [updated] = await db
    .update(researchJobs)
    .set({ steps, state, budget, coverage, status, error: fatalError ?? null, lockedUntil: null, startedAt, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(researchJobs.id, job.id))
    .returning();
  if (onFinish) {
    try {
      await onFinish(updated);
    } catch {
      /* finishing hooks are best-effort */
    }
  }
  await logActivity(job.workspaceId, "research", `${labelFor(job.jobType)} ${status === "complete" ? "completed" : status === "partial" ? "finished with partial results" : "failed"}`, hrefFor(updated));
  return updated;
}

function labelFor(type: string) {
  return type === "event" ? "Event research" : type === "idea_research" ? "Competitor research" : "Opportunity exploration";
}

function hrefFor(job: JobRow) {
  if (job.jobType === "event" && job.hackathonId) return `/hackathons/${job.hackathonId}`;
  if (job.jobType === "idea_research" && job.ideaId) return `/ideas/${job.ideaId}`;
  return "/radar";
}

export async function logActivity(workspaceId: string, kind: string, message: string, href?: string | null) {
  try {
    const db = await getDb();
    await db.insert(activityLog).values({ id: newId("act"), workspaceId, kind, message, href: href ?? null });
  } catch {
    /* non-critical */
  }
}
