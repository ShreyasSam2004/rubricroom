import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { submissionReadiness } from "@/lib/agents/proof";
import { getDb } from "@/lib/db/client";
import { jobSummaryColumns } from "@/lib/db/columns";
import { activityLog, buildPlans, buildTasks, debateTurns, hackathons, ideaAssessments, projectIdeas, researchJobs, submissionEvidence } from "@/lib/db/schema";

export async function dashboardData(workspaceId: string, activeHackathonId: string | null) {
  const db = await getDb();
  const [hacks, ideas, activity, runningJobs, pendingUpdates] = await Promise.all([
    db.select().from(hackathons).where(eq(hackathons.workspaceId, workspaceId)).orderBy(desc(hackathons.updatedAt)).limit(6),
    db.select().from(projectIdeas).where(and(eq(projectIdeas.workspaceId, workspaceId), sql`${projectIdeas.status} <> 'archived'`)).orderBy(desc(projectIdeas.updatedAt)),
    db.select().from(activityLog).where(eq(activityLog.workspaceId, workspaceId)).orderBy(desc(activityLog.createdAt)).limit(8),
    db.select(jobSummaryColumns).from(researchJobs).where(and(eq(researchJobs.workspaceId, workspaceId), sql`${researchJobs.status} not in ('complete','partial','failed')`)).limit(5),
    db.select({ id: debateTurns.id, sessionId: debateTurns.sessionId, ideaUpdate: debateTurns.ideaUpdate }).from(debateTurns).where(and(eq(debateTurns.workspaceId, workspaceId), isNotNull(debateTurns.ideaUpdate))),
  ]);
  const assessmentIds = ideas.map((i) => i.latestAssessmentId).filter(Boolean) as string[];
  const assessments = assessmentIds.length ? await db.select().from(ideaAssessments).where(inArray(ideaAssessments.id, assessmentIds)) : [];
  const selected = ideas.find((i) => i.status === "selected" && (!activeHackathonId || i.hackathonId === activeHackathonId)) ?? null;
  let plan: { id: string; done: number; total: number; postDeadline: boolean } | null = null;
  if (selected) {
    const [p] = await db.select().from(buildPlans).where(and(eq(buildPlans.workspaceId, workspaceId), eq(buildPlans.ideaId, selected.id))).orderBy(desc(buildPlans.createdAt)).limit(1);
    if (p) {
      const tasks = await db.select({ status: buildTasks.status, tier: buildTasks.tier }).from(buildTasks).where(eq(buildTasks.planId, p.id));
      const counted = tasks.filter((t) => t.tier !== "optional");
      plan = { id: p.id, done: counted.filter((t) => t.status === "done").length, total: counted.length, postDeadline: p.postDeadline };
    }
  }
  const active = hacks.find((h) => h.id === activeHackathonId) ?? null;
  let readiness: ReturnType<typeof submissionReadiness> | null = null;
  if (active) {
    const ev = await db.select().from(submissionEvidence).where(and(eq(submissionEvidence.workspaceId, workspaceId), eq(submissionEvidence.hackathonId, active.id)));
    readiness = submissionReadiness(active.dossier?.submission ?? [], ev);
  }
  return {
    hackathons: hacks,
    active,
    ideas: ideas.map((i) => ({ idea: i, assessment: assessments.find((a) => a.id === i.latestAssessmentId) ?? null })),
    selected,
    activity,
    runningJobs,
    pendingUpdates: pendingUpdates.filter((t) => t.ideaUpdate?.status === "proposed"),
    plan,
    readiness,
  };
}
