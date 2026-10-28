// Example runs are copied into each visitor's workspace with fresh ids: two visitors never share a
// row, references between rows survive the copy, and opening an example twice is a no-op.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { buildTasks, debateTurns, existingProjects, workspaces } from "@/lib/db/schema";
import { getDebateBundle } from "@/lib/services/debates";
import { EXAMPLE_TABLES, ensureExample, listExamples } from "@/lib/services/examples";
import { getHackathonBundle } from "@/lib/services/hackathons";
import { getIdeaBundle } from "@/lib/services/ideas";
import { getPlanBundle, latestPlanFor } from "@/lib/services/plans";
import fixture from "@/seed/examples.json";

const A = `ws_${"c".repeat(32)}`;
const B = `ws_${"d".repeat(32)}`;
const examples = listExamples();

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  await db.insert(workspaces).values([{ id: A }, { id: B }]);
});

afterAll(async () => {
  await resetDbForTests();
});

describe("example runs", () => {
  it("ships at least two captured examples on different hackathons", () => {
    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(new Set(examples.map((e) => e.hackathonName)).size).toBe(examples.length);
  });

  it.each(examples.map((e) => e.key))("%s opens as a complete, cited run", async (key) => {
    const { hackathonId, ideaId, created } = await ensureExample(A, key);
    expect(created).toBe(true);
    const h = (await getHackathonBundle(A, hackathonId))!;
    expect(h.hackathon.origin).toBe("cached_seed");
    expect(h.hackathon.seedKey).toBe(`example:${key}`);
    expect(h.sources.length).toBeGreaterThan(0);
    expect(h.sources.every((s) => s.cached)).toBe(true);
    expect(h.claims.every((c) => !c.sourceId || h.sources.some((s) => s.id === c.sourceId))).toBe(true);

    const idea = (await getIdeaBundle(A, ideaId!))!;
    expect(idea.idea.origin).toBe("sample");
    // Verdict scores against a published rubric only; without one the assessment is rule-based.
    expect(idea.latest?.method).toBe(h.criteria.length ? "ai" : "heuristic");
    expect(idea.debates.length).toBe(1);
    expect(idea.latest?.createdAt).toBeInstanceOf(Date);

    const debate = (await getDebateBundle(A, idea.debates[0].id))!;
    expect(debate.turns.filter((t) => t.speaker === "user").length).toBeGreaterThanOrEqual(2);
    const plan = (await latestPlanFor(A, ideaId!))!;
    const bundle = (await getPlanBundle(A, plan.id))!;
    expect(bundle.tasks.length).toBeGreaterThan(0);
    expect(bundle.demo).not.toBeNull();
  });

  it("is idempotent per workspace and gives each workspace its own ids", async () => {
    const key = examples[0].key;
    const again = await ensureExample(A, key);
    expect(again.created).toBe(false);
    const other = await ensureExample(B, key);
    expect(other.created).toBe(true);
    expect(other.hackathonId).not.toBe(again.hackathonId);

    const db = await getDb();
    const ids = async (ws: string) => {
      const all = new Set<string>();
      for (const table of Object.values(EXAMPLE_TABLES)) for (const r of (await db.select().from(table as typeof buildTasks).where(eq((table as typeof buildTasks).workspaceId, ws))) as { id: string }[]) all.add(r.id);
      return all;
    };
    const a = await ids(A);
    for (const id of await ids(B)) expect(a.has(id)).toBe(false);

    // Rows only point at rows in their own copy.
    const turns = await db.select().from(debateTurns).where(eq(debateTurns.workspaceId, B));
    const plans = await db.select().from(buildTasks).where(eq(buildTasks.workspaceId, B));
    const projects = await db.select().from(existingProjects).where(and(eq(existingProjects.workspaceId, B)));
    const bIds = await ids(B);
    for (const t of turns) expect(bIds.has(t.sessionId)).toBe(true);
    for (const t of plans) expect(bIds.has(t.planId)).toBe(true);
    for (const p of projects) for (const s of p.sourceIds) expect(bIds.has(s)).toBe(true);
  });

  it("carries no capture-time workspace id into a copy", async () => {
    const db = await getDb();
    const captureIds = (fixture as { examples: { workspaceId: string }[] }).examples.map((e) => e.workspaceId);
    for (const table of Object.values(EXAMPLE_TABLES)) {
      const rows = await db.select().from(table as typeof buildTasks).where(eq((table as typeof buildTasks).workspaceId, B));
      const text = JSON.stringify(rows);
      for (const ws of captureIds) expect(text.includes(ws)).toBe(false);
    }
  });
});
