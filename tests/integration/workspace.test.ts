import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { claims, judgingCriteria, workspaces } from "@/lib/db/schema";
import { consume } from "@/lib/rate-limit";
import { addDebateTurn, getDebateBundle, resolveIdeaUpdate, startDebate } from "@/lib/services/debates";
import { ensureDemoWorkspace } from "@/lib/services/demo-seed";
import { addEvidence, evidenceBoard } from "@/lib/services/evidence";
import { getHackathonBundle, listHackathons } from "@/lib/services/hackathons";
import { getIdea, getIdeaBundle, listIdeas } from "@/lib/services/ideas";
import { createPlan, getPlanBundle, updateTask } from "@/lib/services/plans";

const A = `ws_${"a".repeat(32)}`;
const B = `ws_${"b".repeat(32)}`;
let hackathonId = "";

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  await db.insert(workspaces).values([{ id: A }, { id: B }]);
  ({ hackathonId } = await ensureDemoWorkspace(A));
});

afterAll(async () => {
  await resetDbForTests();
});

describe("public demo seed", () => {
  it("loads the WeMakeDevs × Wispr dossier with verified rubric and deadline", async () => {
    const b = (await getHackathonBundle(A, hackathonId))!;
    expect(b.hackathon.name).toBe("No Hands: The Wispr Challenge");
    expect(b.hackathon.origin).toBe("cached_seed");
    expect(b.hackathon.deadlineAt?.toISOString()).toBe("2026-10-31T18:29:00.000Z");
    expect(b.criteria.map((c) => c.weight)).toEqual([30, 30, 25, 15]);
    expect(b.sources.every((s) => s.cached)).toBe(true);
    const verified = b.claims.filter((c) => c.verification === "verified").length;
    expect(verified / b.claims.length).toBeGreaterThan(0.9);
  });

  it("is idempotent and labels sample ideas", async () => {
    expect((await ensureDemoWorkspace(A)).created).toBe(false);
    const ideas = await listIdeas(A, hackathonId);
    expect(ideas.map((i) => i.idea.origin)).toEqual(["sample", "sample", "sample"]);
    expect(ideas.map((i) => i.idea.name)).not.toContain("RubricRoom");
  });

  it("ships no cached competitor research; the coverage says so", async () => {
    const b = (await getHackathonBundle(A, hackathonId))!;
    expect(b.hackathon.coverage?.find((c) => c.key === "competitor_research")?.status).toBe("not_searched");
    for (const i of await listIdeas(A, hackathonId)) expect((await getIdeaBundle(A, i.idea.id))!.projects).toEqual([]);
  });
});

describe("cross-user isolation", () => {
  it("never exposes one anonymous workspace's data to another", async () => {
    expect(await listHackathons(B)).toEqual([]);
    expect(await getHackathonBundle(B, hackathonId)).toBeNull();
    const ideaOfA = (await listIdeas(A))[0].idea.id;
    expect(await getIdea(B, ideaOfA)).toBeNull();
    expect(await getIdeaBundle(B, ideaOfA)).toBeNull();
    const db = await getDb();
    const rows = await db.select().from(claims).where(eq(claims.workspaceId, B));
    expect(rows).toHaveLength(0);
  });

  it("refuses to start a debate on someone else's idea", async () => {
    const ideaOfA = (await listIdeas(A))[0].idea.id;
    await expect(startDebate(B, { ideaId: ideaOfA, mode: "critical" })).rejects.toThrow(/not found/i);
  });
});

describe("Judge's Room end-to-end (offline judge)", () => {
  it("saves turns, revises only with evidence, and records the audit trail", async () => {
    const idea = (await listIdeas(A, hackathonId)).find((i) => i.idea.name === "AI Interview Academy")!;
    const session = await startDebate(A, { ideaId: idea.idea.id, mode: "critical" });
    let b = (await getDebateBundle(A, session.id))!;
    expect(b.turns).toHaveLength(1);
    expect(b.turns[0].speaker).toBe("judge");
    const before = b.current!.criterionResults.find((r) => r.name.startsWith("Does it solve"))!.rating;

    const t1 = await addDebateTurn(A, session.id, { text: "Judges will love this, it's guaranteed to go viral." });
    expect(t1.changes).toHaveLength(0);
    expect(t1.claims[0].status).toBe("rejected");

    const t2 = await addDebateTurn(A, session.id, { text: "I personally prepare for interviews every day and I lose track of what I got wrong." });
    expect(t2.changes.map((c) => [c.from, c.to])).toEqual([[before, before + 1]]);

    b = (await getDebateBundle(A, session.id))!;
    expect(b.turns.map((t) => t.speaker)).toEqual(["judge", "user", "judge", "user", "judge"]);
    expect(b.session.acceptedClaims).toHaveLength(1);
    expect(b.session.rejectedClaims).toHaveLength(1);
    const bundle = (await getIdeaBundle(A, idea.idea.id))!;
    expect(bundle.revisions[0].changes[0].to).toBe(before + 1);
    expect(bundle.revisions[0].debateTurnId).toBeTruthy();
  });

  it("applies a dictated correction only after confirmation, creating an immutable new version", async () => {
    const idea = (await listIdeas(A, hackathonId)).find((i) => i.idea.name === "AI Interview Academy")!;
    const session = await startDebate(A, { ideaId: idea.idea.id, mode: "technical" });
    const t = await addDebateTurn(A, session.id, { text: "You misunderstood. Remove the video calls from the MVP and focus on the web dashboard." });
    let bundle = (await getIdeaBundle(A, idea.idea.id))!;
    expect(bundle.current.features).toContain("Video calls"); // nothing applied yet
    const v1 = bundle.current;
    const r = await resolveIdeaUpdate(A, t.judgeTurn.id, "apply");
    expect(r.applied).toBe(true);
    bundle = (await getIdeaBundle(A, idea.idea.id))!;
    expect(bundle.current.features).not.toContain("Video calls");
    expect(bundle.current.features).toContain("Personalized dashboard");
    expect(bundle.current.parentVersionId).toBe(v1.id);
    expect(bundle.versions.find((v) => v.id === v1.id)!.features).toContain("Video calls"); // old version untouched
  });
});

describe("planner and evidence", () => {
  it("creates a plan, saves task progress and tracks submission readiness honestly", async () => {
    const idea = (await listIdeas(A, hackathonId)).find((i) => i.idea.name === "Freelance Proposal Agent")!;
    const planId = await createPlan(A, idea.idea.id);
    const plan = (await getPlanBundle(A, planId))!;
    expect(plan.tasks.length).toBeGreaterThan(5);
    const t = plan.tasks[0];
    await updateTask(A, t.id, { status: "done", notes: "deployed" });
    const again = (await getPlanBundle(A, planId))!;
    expect(again.tasks.find((x) => x.id === t.id)!.status).toBe("done");
    expect(await getPlanBundle(B, planId)).toBeNull();

    await addEvidence(A, { hackathonId, ideaId: idea.idea.id, deliverableKey: "description", artifactType: "note", title: "Problem write-up", notes: "I spent two days comparing ideas." });
    const board = (await evidenceBoard(A, hackathonId, idea.idea.id))!;
    expect(board.readiness.required).toBe(4);
    expect(board.readiness.prepared).toBe(1);
    expect(board.rows.map((r) => r.criterion.weight)).toEqual([30, 30, 25, 15]);
  });
});

describe("rate limits", () => {
  it("allows up to the limit then refuses", async () => {
    const scope = `test:${Date.now()}`;
    for (let i = 0; i < 3; i++) expect((await consume(scope, 3, 60)).allowed).toBe(true);
    const r = await consume(scope, 3, 60);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("schema", () => {
  it("stores criteria with their weight basis", async () => {
    const db = await getDb();
    const rows = await db.select().from(judgingCriteria).where(eq(judgingCriteria.workspaceId, A));
    expect(new Set(rows.map((r) => r.weightBasis))).toEqual(new Set(["markup_recovered"]));
  });
});
