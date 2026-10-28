// The sample workspace: what a first-time visitor (often a hackathon judge) lands in, so every page
// shows RubricRoom working instead of an empty state. It is the cached WeMakeDevs × Wispr Flow demo
// run through the real agents by scripts/capture-showcase.ts; each visitor gets a private copy with
// fresh ids, labelled as a sample. Visitors who already have their own data never receive it.

import { and, eq, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import fixture from "@/seed/showcase.json";
import { getDb } from "@/lib/db/client";
import { hackathons, opportunitySets, projectIdeas, submissionEvidence, workspaces } from "@/lib/db/schema";
import { consume } from "@/lib/rate-limit";
import { logActivity } from "@/lib/research/jobs";
import { DEMO_SEED_KEY, ensureDemoWorkspace, findDemoHackathon } from "./demo-seed";
import { EXAMPLE_TABLES, remapRows, reviveDates } from "./examples";

/** Tables the sample workspace spans: an example run's, plus evidence and Opportunity Radar results. */
export const SHOWCASE_TABLES = {
  ...EXAMPLE_TABLES,
  submission_evidence: submissionEvidence,
  opportunity_sets: opportunitySets,
} satisfies Record<string, PgTable>;

type ShowcaseTableName = keyof typeof SHOWCASE_TABLES;

interface ShowcaseFixture {
  generatedAt: string;
  model: string;
  disclosure: string;
  workspaceId: string;
  hackathonId: string;
  activeIdeaId: string | null;
  sessionIds: string[];
  planId: string | null;
  rows: Partial<Record<ShowcaseTableName, Record<string, unknown>[]>>;
}

const FIXTURE = fixture as unknown as ShowcaseFixture;
const CAPTURED = Boolean(FIXTURE.rows.hackathons?.length);

/** What the sample was captured with, for its labels; null before the first capture. */
export const SHOWCASE_META = CAPTURED ? { capturedAt: FIXTURE.generatedAt, model: FIXTURE.model, disclosure: FIXTURE.disclosure } : null;

/**
 * Idempotent: opens the existing copy if this workspace already has the demo hackathon. Until the
 * sample has been captured it falls back to the plain cached demo.
 */
export async function ensureShowcase(workspaceId: string) {
  const existing = await findDemoHackathon(workspaceId);
  if (existing) return { hackathonId: existing.id, created: false };
  if (!CAPTURED) return ensureDemoWorkspace(workspaceId);
  const { rows, map } = remapRows(FIXTURE.rows, FIXTURE.workspaceId, workspaceId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const [name, table] of Object.entries(SHOWCASE_TABLES) as [ShowcaseTableName, PgTable][]) {
      const list = (rows[name] ?? []).map((r) => reviveDates(table, { ...r, workspaceId }));
      for (let i = 0; i < list.length; i += 200) await tx.insert(table).values(list.slice(i, i + 200) as never);
    }
  });
  const hackathonId = map(FIXTURE.hackathonId)!;
  // Opening the sample is the visitor's starting point, so it stays active after its deadline too.
  await db.update(workspaces).set({ activeHackathonId: hackathonId, activeIdeaId: map(FIXTURE.activeIdeaId), activePinned: true, switchedFromId: null }).where(eq(workspaces.id, workspaceId));
  await logActivity(workspaceId, "demo", "Opened the sample workspace: WeMakeDevs × Wispr Flow", `/hackathons/${hackathonId}`);
  return { hackathonId, created: true };
}

// Crawlers, link previews and scripts don't keep cookies, so each request would get a new copy.
const NOT_A_PERSON = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|linkedin|twitter|pinterest|monitor|uptime|pingdom|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|undici/i;
const PER_IP_PER_DAY = 40;

/**
 * Called on a page view. A brand-new, empty workspace gets the sample once; a workspace that already
 * has hackathons or ideas is only marked, so the sample never mixes into someone's own work.
 */
export async function offerShowcase(ws: { id: string; showcaseAt: Date | null }, visitor: { userAgent: string | null; ip: string }) {
  if (ws.showcaseAt || !visitor.userAgent || NOT_A_PERSON.test(visitor.userAgent)) return false;
  const db = await getDb();
  const [claimed] = await db.update(workspaces).set({ showcaseAt: new Date() }).where(and(eq(workspaces.id, ws.id), isNull(workspaces.showcaseAt))).returning({ id: workspaces.id });
  if (!claimed) return false; // another request got here first
  const [hackathon] = await db.select({ id: hackathons.id }).from(hackathons).where(eq(hackathons.workspaceId, ws.id)).limit(1);
  const [idea] = await db.select({ id: projectIdeas.id }).from(projectIdeas).where(eq(projectIdeas.workspaceId, ws.id)).limit(1);
  if (hackathon || idea) return false;
  if (!(await consume(`showcase:${visitor.ip}`, PER_IP_PER_DAY, 86_400)).allowed) return false;
  await ensureShowcase(ws.id);
  return true;
}

export const isShowcaseHackathon = (h: { seedKey: string | null }) => h.seedKey === DEMO_SEED_KEY;
