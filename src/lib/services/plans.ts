import { and, asc, desc, eq } from "drizzle-orm";
import { heuristicFeasibility } from "@/lib/agents/forge";
import { sprintDemo, sprintPlan } from "@/lib/agents/sprint";
import { getDb } from "@/lib/db/client";
import { buildPlans, buildTasks, demoPlans, submissionEvidence } from "@/lib/db/schema";
import { logActivity } from "@/lib/research/jobs";
import { newId } from "@/lib/text";
import { currentVersion, getIdea, refreshFeasibility, rubricContext, versionToFields } from "./ideas";
import { getProfile } from "./profile";

export type PlanRow = typeof buildPlans.$inferSelect;
export type TaskRow = typeof buildTasks.$inferSelect;

export async function createPlan(workspaceId: string, ideaId: string, opts: { hoursPerDay?: number; scopeChange?: string | null; maxDays?: number | null } = {}) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found");
  const version = await currentVersion(workspaceId, idea);
  const { hackathon, sponsors } = await rubricContext(workspaceId, idea.hackathonId);
  const profile = await getProfile(workspaceId);
  let feasibility = idea.feasibility;
  if (!feasibility || new Date(feasibility.createdAt) < version.createdAt) {
    try {
      feasibility = await refreshFeasibility(workspaceId, ideaId);
    } catch {
      feasibility = heuristicFeasibility(versionToFields(version), profile.data, null);
    }
  }
  const draft = await sprintPlan(workspaceId, {
    idea: versionToFields(version),
    feasibility,
    submission: hackathon?.dossier?.submission ?? [],
    sponsors,
    deadline: hackathon?.deadlineAt ?? null,
    timezone: hackathon?.timezone ?? null,
    hoursPerDay: opts.hoursPerDay ?? profile.data.hoursPerDay,
    scopeChanges: opts.scopeChange ?? null,
    maxDays: opts.maxDays ?? null,
  });
  const planId = newId("plan");
  const idByKey = new Map(draft.tasks.map((t) => [t.key, newId("task")]));
  await db.transaction(async (tx) => {
    await tx.insert(buildPlans).values({
      id: planId,
      workspaceId,
      ideaId,
      ideaVersionId: version.id,
      deadlineAt: hackathon?.deadlineAt ?? null,
      hoursPerDay: draft.hoursPerDay,
      totalHours: draft.totalHours,
      tiers: draft.tiers,
      architecture: draft.architecture,
      days: draft.days,
      risks: draft.risks,
      assumptions: draft.assumptions,
      postDeadline: draft.postDeadline,
      method: draft.method,
    });
    const dayDate = new Map(draft.days.map((d) => [d.day, d.date]));
    await tx.insert(buildTasks).values(
      draft.tasks.map((t, i) => ({
        id: idByKey.get(t.key)!,
        planId,
        workspaceId,
        title: t.title,
        description: t.description,
        day: t.day,
        tier: t.tier,
        priority: t.priority,
        dueAt: dayDate.get(t.day) ? new Date(`${dayDate.get(t.day)}T23:59:00+05:30`) : null,
        dependsOn: t.dependsOn.map((k) => idByKey.get(k)).filter(Boolean) as string[],
        acceptance: t.acceptance,
        estimateHours: t.estimateHours,
        position: i,
      })),
    );
  });
  await logActivity(workspaceId, "plan", `Build plan created for “${idea.name}” (${draft.days.length} day${draft.days.length === 1 ? "" : "s"}${draft.postDeadline ? ", post-deadline roadmap" : ""})`, `/plan/${planId}`);
  return planId;
}

export async function latestPlanFor(workspaceId: string, ideaId: string) {
  const db = await getDb();
  const [plan] = await db.select().from(buildPlans).where(and(eq(buildPlans.workspaceId, workspaceId), eq(buildPlans.ideaId, ideaId))).orderBy(desc(buildPlans.createdAt)).limit(1);
  return plan ?? null;
}

export async function getPlanBundle(workspaceId: string, planId: string) {
  const db = await getDb();
  const [plan] = await db.select().from(buildPlans).where(and(eq(buildPlans.id, planId), eq(buildPlans.workspaceId, workspaceId)));
  if (!plan) return null;
  const tasks = await db.select().from(buildTasks).where(and(eq(buildTasks.planId, planId), eq(buildTasks.workspaceId, workspaceId))).orderBy(asc(buildTasks.day), asc(buildTasks.position));
  const idea = await getIdea(workspaceId, plan.ideaId);
  const [demo] = await db.select().from(demoPlans).where(and(eq(demoPlans.workspaceId, workspaceId), eq(demoPlans.ideaId, plan.ideaId))).orderBy(desc(demoPlans.createdAt)).limit(1);
  return { plan, tasks, idea, demo: demo ?? null };
}

export async function updateTask(workspaceId: string, taskId: string, patch: Partial<Pick<TaskRow, "status" | "notes" | "proofUrl" | "priority" | "title" | "day" | "tier">>) {
  const db = await getDb();
  const [row] = await db.update(buildTasks).set({ ...patch, updatedAt: new Date() }).where(and(eq(buildTasks.id, taskId), eq(buildTasks.workspaceId, workspaceId))).returning();
  if (row && patch.status === "done") await logActivity(workspaceId, "plan", `Completed: ${row.title}`, `/plan/${row.planId}`);
  return row ?? null;
}

export async function addTask(workspaceId: string, planId: string, t: { title: string; day: number; tier?: string; priority?: string }) {
  const db = await getDb();
  const [plan] = await db.select().from(buildPlans).where(and(eq(buildPlans.id, planId), eq(buildPlans.workspaceId, workspaceId)));
  if (!plan) throw new Error("Plan not found");
  const [row] = await db
    .insert(buildTasks)
    .values({ id: newId("task"), planId, workspaceId, title: t.title, day: Math.max(1, Math.min(plan.days.length, t.day)), tier: t.tier ?? "core", priority: t.priority ?? "medium", position: 999 })
    .returning();
  return row;
}

export async function deleteTask(workspaceId: string, taskId: string) {
  const db = await getDb();
  await db.delete(buildTasks).where(and(eq(buildTasks.id, taskId), eq(buildTasks.workspaceId, workspaceId)));
}

export function planToMarkdown(b: NonNullable<Awaited<ReturnType<typeof getPlanBundle>>>) {
  const L: string[] = [`# Build plan — ${b.idea?.name ?? "Project"}`, ""];
  if (b.plan.postDeadline) L.push("> **Post-deadline roadmap** — the submission deadline has passed.", "");
  L.push(`Deadline: ${b.plan.deadlineAt ? b.plan.deadlineAt.toISOString() : "not verified"} · ~${b.plan.totalHours}h available (${b.plan.hoursPerDay}h/day)`, "");
  L.push("## Scope", "");
  for (const t of b.plan.tiers) L.push(`**${t.label}:** ${t.features.join("; ") || "—"}`, "");
  L.push("## Architecture", "", ...Object.entries(b.plan.architecture).map(([k, v]) => `- **${k}:** ${Array.isArray(v) ? v.join(", ") : v}`), "");
  for (const d of b.plan.days) {
    L.push(`## Day ${d.day} — ${d.date} (~${d.hours}h)`, "", `Goal: ${d.goal}`, `Artifact: ${d.artifact}`, "");
    for (const t of b.tasks.filter((x) => x.day === d.day)) L.push(`- [${t.status === "done" ? "x" : " "}] ${t.title}${t.tier !== "core" ? ` _(${t.tier})_` : ""}${t.acceptance ? ` — ✓ ${t.acceptance}` : ""}`);
    L.push("");
  }
  L.push("## Risks", "", ...b.plan.risks.map((r) => `- **${r.category}** (${r.likelihood}): ${r.description} → ${r.mitigation}${r.scopeReduction ? ` _Cut: ${r.scopeReduction}_` : ""}`), "");
  L.push("## Assumptions", "", ...b.plan.assumptions.map((a) => `- ${a}`));
  return L.join("\n");
}

// ---------------------------------------------------------------- demo strategy

export async function createDemo(workspaceId: string, ideaId: string, opts: { timeLimitSec?: number; refinement?: string | null }) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found");
  const version = await currentVersion(workspaceId, idea);
  const plan = await latestPlanFor(workspaceId, ideaId);
  const tasks = plan ? await db.select().from(buildTasks).where(eq(buildTasks.planId, plan.id)) : [];
  const strip = (t: string) => t.replace(/^(Build|Add|Optional): /, "");
  const featureTasks = tasks.filter((t) => /^(Build|Add|Optional): /.test(t.title));
  const implemented = featureTasks.filter((t) => t.status === "done").map((t) => strip(t.title));
  const notImplemented = featureTasks.filter((t) => t.status !== "done").map((t) => strip(t.title));
  const evidence = idea.hackathonId ? await db.select().from(submissionEvidence).where(and(eq(submissionEvidence.workspaceId, workspaceId), eq(submissionEvidence.ideaId, ideaId))) : [];
  const realResults = evidence.filter((e) => e.artifactType === "note" && e.notes).map((e) => `${e.title}: ${e.notes}`).slice(0, 4);
  const { sponsors, hackathon } = await rubricContext(workspaceId, idea.hackathonId);
  const videoReq = hackathon?.dossier?.submission.find((s) => s.key === "demo_video");
  const limitFromRules = videoReq?.detail?.match(/(\d+|one|two|three|four|five)\s*min/i);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const ruleSec = limitFromRules ? (Number(limitFromRules[1]) || words[limitFromRules[1].toLowerCase()]) * 60 : null;
  const [prev] = await db.select().from(demoPlans).where(and(eq(demoPlans.workspaceId, workspaceId), eq(demoPlans.ideaId, ideaId))).orderBy(desc(demoPlans.createdAt)).limit(1);
  const draft = await sprintDemo(workspaceId, {
    idea: versionToFields(version),
    implemented: implemented.length ? implemented : [],
    notImplemented,
    realResults,
    sponsor: sponsors.find((s) => !/wemakedevs|devpost|mlh/i.test(s)) ?? null,
    timeLimitSec: opts.timeLimitSec ?? ruleSec ?? 120,
    refinement: opts.refinement ?? null,
    previous: prev && opts.refinement ? { hook: prev.hook, segments: prev.segments, closing: prev.closing } : null,
  });
  const id = newId("demo");
  await db.insert(demoPlans).values({
    id,
    workspaceId,
    ideaId,
    timeLimitSec: opts.timeLimitSec ?? ruleSec ?? 120,
    hook: draft.hook,
    segments: draft.segments,
    closing: draft.closing,
    checklist: [...draft.checklist, ...(implemented.length ? [] : ["No feature tasks are marked done yet — the script only describes the flow; mark tasks done as you build so the script stays honest."])],
    excludedFeatures: draft.excludedFeatures,
    refinements: [...(prev?.refinements ?? []), ...(opts.refinement ? [opts.refinement] : [])],
    method: draft.method,
  });
  return id;
}
