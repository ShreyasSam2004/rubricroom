import { z } from "zod";
import { eq, getTableName } from "drizzle-orm";
import { apiHandler } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { dismissSwitchNotice } from "@/lib/services/hackathons";

const OWNED = [
  s.activityLog,
  s.submissionEvidence,
  s.uploads,
  s.demoPlans,
  s.buildTasks,
  s.buildPlans,
  s.debateTurns,
  s.debateSessions,
  s.assessmentRevisions,
  s.ideaAssessments,
  s.ideaVersions,
  s.projectIdeas,
  s.existingProjects,
  s.opportunitySets,
  s.researchJobs,
  s.claims,
  s.hackathonRules,
  s.judgingCriteria,
  s.researchSources,
  s.hackathons,
  s.builderProfiles,
] as const;

/** Export everything this anonymous workspace owns (JSON). Uploaded file bytes are excluded. */
export const GET = apiHandler(null, async ({ workspaceId }) => {
  const db = await getDb();
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), workspaceId };
  for (const table of OWNED) {
    const name = getTableName(table);
    const rows = await db.select().from(table).where(eq(table.workspaceId, workspaceId));
    out[name] = name === "uploads" ? rows.map((r) => ({ ...r, data: undefined })) : rows;
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="rubricroom-workspace.json"` } });
});

/** Dismiss the notice that the active hackathon was switched after a deadline passed. */
export const POST = apiHandler(z.object({ action: z.literal("dismiss_switch") }), async ({ workspaceId }) => {
  await dismissSwitchNotice(workspaceId);
  return { ok: true };
});

/** Permanently delete this workspace's data (explicit, confirmed in the UI). */
export const DELETE = apiHandler(z.object({ confirm: z.literal("DELETE") }), async ({ workspaceId }) => {
  const db = await getDb();
  for (const table of OWNED) await db.delete(table).where(eq(table.workspaceId, workspaceId));
  await db.update(s.workspaces).set({ activeHackathonId: null, activeIdeaId: null, activePinned: false, switchedFromId: null }).where(eq(s.workspaces.id, workspaceId));
  return { ok: true };
});
