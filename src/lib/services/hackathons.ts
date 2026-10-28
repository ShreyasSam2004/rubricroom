import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobSummaryColumns, sourceSummaryColumns } from "@/lib/db/columns";
import { claims, existingProjects, hackathonRules, hackathons, judgingCriteria, researchJobs, researchSources, workspaces } from "@/lib/db/schema";
import { isUpcoming } from "@/lib/deadline";
import { assertSafeUrl } from "@/lib/net/safe-url";
import { createJob, logActivity } from "@/lib/research/jobs";
import { hostOf, newId } from "@/lib/text";

export type HackathonRow = typeof hackathons.$inferSelect;

export async function listHackathons(workspaceId: string) {
  const db = await getDb();
  return db.select().from(hackathons).where(eq(hackathons.workspaceId, workspaceId)).orderBy(desc(hackathons.updatedAt));
}

/** Upcoming first (closing soonest first), then those without a verified deadline, then past ones (latest first). */
export function upcomingFirst<T extends { deadlineAt: Date | null }>(list: T[], now = new Date()) {
  const rank = (h: T) => (!h.deadlineAt ? 1 : h.deadlineAt > now ? 0 : 2);
  const time = (h: T) => h.deadlineAt?.getTime() ?? 0;
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? time(a) - time(b) : time(b) - time(a)));
}

export async function getHackathon(workspaceId: string, id: string) {
  const db = await getDb();
  const [h] = await db.select().from(hackathons).where(and(eq(hackathons.id, id), eq(hackathons.workspaceId, workspaceId)));
  return h ?? null;
}

export async function getHackathonBundle(workspaceId: string, id: string) {
  const db = await getDb();
  const h = await getHackathon(workspaceId, id);
  if (!h) return null;
  const [criteria, rules, claimRows, sources, projects, jobs] = await Promise.all([
    db.select().from(judgingCriteria).where(and(eq(judgingCriteria.hackathonId, id), eq(judgingCriteria.workspaceId, workspaceId))).orderBy(asc(judgingCriteria.position)),
    db.select().from(hackathonRules).where(and(eq(hackathonRules.hackathonId, id), eq(hackathonRules.workspaceId, workspaceId))).orderBy(asc(hackathonRules.position)),
    db.select().from(claims).where(and(eq(claims.hackathonId, id), eq(claims.workspaceId, workspaceId))),
    db.select(sourceSummaryColumns).from(researchSources).where(and(eq(researchSources.hackathonId, id), eq(researchSources.workspaceId, workspaceId))).orderBy(asc(researchSources.authority)),
    db.select().from(existingProjects).where(and(eq(existingProjects.workspaceId, workspaceId), eq(existingProjects.hackathonId, id))).orderBy(desc(existingProjects.createdAt)),
    db.select(jobSummaryColumns).from(researchJobs).where(and(eq(researchJobs.hackathonId, id), eq(researchJobs.workspaceId, workspaceId), eq(researchJobs.jobType, "event"))).orderBy(desc(researchJobs.createdAt)).limit(1),
  ]);
  return { hackathon: h, criteria, rules, claims: claimRows, sources, projects, job: jobs[0] ?? null };
}

/**
 * `pinned`: the visitor chose it themselves, so a passed deadline doesn't move them off it.
 * `switchedFrom`: set only by the automatic switch, so the top bar can say what happened.
 */
export async function setActiveHackathon(workspaceId: string, hackathonId: string, opts: { pinned?: boolean; switchedFrom?: string } = {}) {
  const db = await getDb();
  await db.update(workspaces).set({ activeHackathonId: hackathonId, activePinned: opts.pinned ?? false, switchedFromId: opts.switchedFrom ?? null }).where(eq(workspaces.id, workspaceId));
}

export async function dismissSwitchNotice(workspaceId: string) {
  const db = await getDb();
  await db.update(workspaces).set({ switchedFromId: null }).where(eq(workspaces.id, workspaceId));
}

/**
 * The hackathon the workspace works on. When its deadline has passed and another researched
 * hackathon is still ahead, the one closing soonest takes over (and the switch is reported, so it
 * is never silent), unless the visitor picked the past one themselves.
 */
export async function resolveActiveHackathon(ws: { id: string; activeHackathonId: string | null; activePinned: boolean; switchedFromId: string | null }) {
  const current = ws.activeHackathonId ? await getHackathon(ws.id, ws.activeHackathonId) : null;
  if (current && (ws.activePinned || !current.deadlineAt || isUpcoming(current))) {
    // A switch made on an earlier request stays announced until the visitor dismisses it.
    const from = ws.switchedFromId && ws.switchedFromId !== current.id ? await getHackathon(ws.id, ws.switchedFromId) : null;
    return { active: current, switchedFrom: from ? { id: from.id, name: from.name } : null };
  }
  // The visitor's own hackathons come before example runs (samples they opened to look at).
  const sample = (h: HackathonRow) => (h.seedKey?.startsWith("example:") ? 1 : 0);
  const upcoming = (await listHackathons(ws.id))
    .filter((h) => h.id !== current?.id && isUpcoming(h))
    .sort((a, b) => sample(a) - sample(b) || a.deadlineAt!.getTime() - b.deadlineAt!.getTime())[0];
  if (!upcoming) return { active: current, switchedFrom: null };
  await setActiveHackathon(ws.id, upcoming.id, { switchedFrom: current?.id });
  if (current) await logActivity(ws.id, "research", `Switched to ${upcoming.name}: the deadline for ${current.name} has passed`, `/hackathons/${upcoming.id}`);
  return { active: upcoming, switchedFrom: current ? { id: current.id, name: current.name } : null };
}

/** Start researching a hackathon from one or more URLs (plus optional pasted rules / PDFs). */
export async function startHackathonResearch(workspaceId: string, input: { urls: string[]; pastedText?: string; uploadIds?: string[]; hackathonId?: string }) {
  const urls = input.urls.map((u) => u.trim()).filter(Boolean);
  for (const u of urls) assertSafeUrl(u); // reject unsafe URLs before creating anything
  if (!urls.length && !input.pastedText?.trim() && !input.uploadIds?.length) throw new Error("Add a hackathon URL, paste the rules, or upload a PDF.");
  const db = await getDb();
  let hackathonId = input.hackathonId;
  if (!hackathonId) {
    hackathonId = newId("hack");
    await db.insert(hackathons).values({
      id: hackathonId,
      workspaceId,
      name: urls[0] ? hostOf(urls[0]) : "Pasted hackathon rules",
      officialUrl: urls[0] ?? null,
      sourceStatus: "pending",
      origin: "live",
    });
  } else {
    const h = await getHackathon(workspaceId, hackathonId);
    if (!h) throw new Error("Hackathon not found");
    await db.update(hackathons).set({ sourceStatus: "pending", updatedAt: new Date() }).where(eq(hackathons.id, hackathonId));
  }
  const job = await createJob({ workspaceId, jobType: "event", hackathonId, input: { urls, pastedText: input.pastedText ?? "", uploadIds: input.uploadIds ?? [] } });
  // Researching another hackathon doesn't silently move the Evidence Board, plans and new pitches
  // over to it; only the first one becomes active on its own ("Make active" switches explicitly,
  // and an active hackathon whose deadline has passed gives way to an upcoming one).
  const [ws] = await db.select({ active: workspaces.activeHackathonId }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws?.active) await setActiveHackathon(workspaceId, hackathonId);
  await logActivity(workspaceId, "research", `Started researching ${urls[0] ?? "pasted rules"}`, `/hackathons/${hackathonId}`);
  return { hackathonId, jobId: job.id };
}

export async function flagClaim(workspaceId: string, claimId: string, note: string) {
  const db = await getDb();
  const [row] = await db
    .update(claims)
    .set({ verification: "user_flagged", note: `Reported incorrect by you: ${note.slice(0, 400)}` })
    .where(and(eq(claims.id, claimId), eq(claims.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}

export async function markSource(workspaceId: string, sourceId: string, status: "outdated" | "retrieved", issue?: string) {
  const db = await getDb();
  const [row] = await db
    .update(researchSources)
    .set({ status, userReportedIssue: issue ?? null })
    .where(and(eq(researchSources.id, sourceId), eq(researchSources.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}

export async function deleteHackathon(workspaceId: string, hackathonId: string) {
  const db = await getDb();
  await db.delete(hackathons).where(and(eq(hackathons.id, hackathonId), eq(hackathons.workspaceId, workspaceId)));
}
