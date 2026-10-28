// First-time visitors land in the sample workspace: a private copy of a captured run, offered once,
// never to crawlers, and never mixed into a workspace that already holds someone's own work.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { buildTasks, debateSessions, debateTurns, opportunitySets, projectIdeas, submissionEvidence, workspaces } from "@/lib/db/schema";
import { DEMO_SEED_KEY } from "@/lib/services/demo-seed";
import { listHackathons } from "@/lib/services/hackathons";
import { createIdea, listIdeas } from "@/lib/services/ideas";
import { ensureShowcase, offerShowcase, SHOWCASE_META } from "@/lib/services/showcase";

const ws = (c: string) => `ws_${c.repeat(32)}`;
const [A, B, BOT, OWN] = [ws("1"), ws("2"), ws("3"), ws("4")];
const browser = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36", ip: "203.0.113.7" };

async function row(id: string) {
  const db = await getDb();
  return (await db.select().from(workspaces).where(eq(workspaces.id, id)))[0];
}

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  await db.insert(workspaces).values([A, B, BOT, OWN].map((id) => ({ id })));
});

afterAll(async () => {
  await resetDbForTests();
});

describe("sample workspace", () => {
  it("has been captured", () => {
    expect(SHOWCASE_META?.model).toBeTruthy();
    expect(SHOWCASE_META?.disclosure).toMatch(/written to demonstrate/);
  });

  it("fills a new, empty workspace on its first page view, once", async () => {
    expect(await offerShowcase(await row(A), browser)).toBe(true);
    expect(await offerShowcase(await row(A), browser)).toBe(false);

    const [h, ...rest] = await listHackathons(A);
    expect(rest).toHaveLength(0);
    expect(h.seedKey).toBe(DEMO_SEED_KEY);
    expect(h.name).toBe("No Hands: The Wispr Challenge");

    const ideas = await listIdeas(A, h.id);
    expect(ideas.map((i) => i.idea.origin)).toEqual(["sample", "sample", "sample"]);
    expect(ideas.map((i) => i.idea.name)).not.toContain("RubricRoom");
    expect(ideas.every((i) => i.assessment?.method === "ai")).toBe(true);
    const selected = ideas.find((i) => i.idea.status === "selected")!;
    expect(selected.idea.name).toBe("Freelance Proposal Agent");

    const w = await row(A);
    expect(w).toMatchObject({ activeHackathonId: h.id, activeIdeaId: selected.idea.id, activePinned: true });
    expect(w.showcaseAt).toBeInstanceOf(Date);

    const db = await getDb();
    const sessions = await db.select().from(debateSessions).where(eq(debateSessions.workspaceId, A));
    expect(sessions).toHaveLength(2);
    const turns = await db.select().from(debateTurns).where(eq(debateTurns.workspaceId, A));
    expect(turns.filter((t) => t.speaker === "user").length).toBeGreaterThanOrEqual(4);
    const tasks = await db.select().from(buildTasks).where(eq(buildTasks.workspaceId, A));
    expect(tasks.filter((t) => t.status === "done")).toHaveLength(2);
    expect(await db.select().from(submissionEvidence).where(eq(submissionEvidence.workspaceId, A))).toHaveLength(1);
    expect((await db.select().from(opportunitySets).where(eq(opportunitySets.workspaceId, A))).length).toBeGreaterThan(0);
  });

  it("gives every visitor a private copy with its own ids", async () => {
    expect(await offerShowcase(await row(B), browser)).toBe(true);
    const db = await getDb();
    const idsOf = async (w: string) => new Set((await db.select({ id: projectIdeas.id }).from(projectIdeas).where(eq(projectIdeas.workspaceId, w))).map((r) => r.id));
    const [a, b] = [await idsOf(A), await idsOf(B)];
    expect(b.size).toBe(3);
    expect([...b].some((id) => a.has(id))).toBe(false);
  });

  it("is not given to crawlers or link previews", async () => {
    expect(await offerShowcase(await row(BOT), { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)", ip: browser.ip })).toBe(false);
    expect(await offerShowcase(await row(BOT), { userAgent: null, ip: browser.ip })).toBe(false);
    expect((await row(BOT)).showcaseAt).toBeNull();
    expect(await listHackathons(BOT)).toEqual([]);
  });

  it("never mixes into a workspace that already has the visitor's own work", async () => {
    await createIdea(OWN, { hackathonId: null, pitch: "A dictation-first checklist for clinic receptionists.", origin: "user" });
    expect(await offerShowcase(await row(OWN), browser)).toBe(false);
    expect((await row(OWN)).showcaseAt).toBeInstanceOf(Date); // asked once, never again
    expect(await listHackathons(OWN)).toEqual([]);
  });

  it("is what the demo button opens, and opening it again is a no-op", async () => {
    const [h] = await listHackathons(A);
    expect(await ensureShowcase(A)).toEqual({ hackathonId: h.id, created: false });
  });
});
