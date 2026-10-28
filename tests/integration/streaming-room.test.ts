// The Judge's Room opens at once and streams: the quick model writes the opening question while
// the full assessment runs, and replies arrive word by word. Also: a passed deadline gives way to
// an upcoming hackathon. The model is a mocked OpenAI endpoint that streams server-sent events.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { hackathons, projectIdeas, workspaces } from "@/lib/db/schema";

const OPENING = "Your pitch says interviews take hours, but whose hours? Tell me about the last time feedback was late and what it cost.";
const REPLY = "That's a specific, first-hand example, so I'm recording it as user-reported evidence. Who else on your team writes feedback, and how long does it take them?";

type Body = { model: string; stream?: boolean; response_format: { json_schema: { name: string } }; messages: { content: string }[] };

function answerFor(body: Body): unknown {
  const name = body.response_format.json_schema.name;
  if (name === "verdict_opening") return { judgeRole: "user_advocate", text: OPENING };
  if (name === "verdict_debate_turn") return { judgeRole: "user_advocate", reply: REPLY, claims: [], proposedChanges: [], concernsResolved: [], newConcerns: [], nextActions: [], ideaUpdate: null };
  if (name === "verdict_assessment") {
    const ids = [...new Set([...body.messages[1].content.matchAll(/id=(crit_[a-f0-9]+)/g)].map((m) => m[1]))];
    const dim = { rating: 2, rationale: "r" };
    return {
      criteria: ids.map((criterionId) => ({ criterionId, rating: 3, rationale: "From the pitch.", evidence: [], gaps: [], confidence: "medium", suggestions: [] })),
      heuristics: { feasibility: dim, competitorOverlap: dim, personalRelevance: dim, researchConfidence: dim, demoReliability: dim, scopeRisk: dim },
      assumptions: [],
      concerns: ["Who has this problem?"],
      openingRole: "user_advocate",
      openingChallenge: "unused",
    };
  }
  return null; // other agents fall back to their rule-based versions
}

/** Server-sent events, re-cut into small pieces so lines and escapes split across reads. */
function sse(content: string, model: string) {
  const events = [];
  for (let i = 0; i < content.length; i += 9) events.push({ model, choices: [{ delta: { content: content.slice(i, i + 9) }, finish_reason: null }] });
  events.push({ model, choices: [{ delta: {}, finish_reason: "stop" }] }, { model, choices: [], usage: { prompt_tokens: 120, completion_tokens: 60 } });
  const raw = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(raw);
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
}

const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Body;
  const answer = answerFor(body);
  if (!answer) return new Response("unavailable in this test", { status: 503 });
  const content = JSON.stringify(answer);
  if (body.stream) return new Response(sse(content, body.model), { status: 200, headers: { "content-type": "text/event-stream" } });
  return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 60 } }), { status: 200 });
});

const callsFor = (schema: string) => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Body).filter((b) => b.response_format.json_schema.name === schema);

beforeAll(() => {
  Object.assign(process.env, { AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-5", AI_FAST_MODEL: "", AI_DAILY_BUDGET_USD: "5" });
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(async () => {
  await resetDbForTests();
  fetchMock.mockClear();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  Object.assign(process.env, { AI_PROVIDER: "none", OPENAI_API_KEY: "" });
  await resetDbForTests();
});

async function demoIdea(ws: string) {
  const db = await getDb();
  await db.insert(workspaces).values({ id: ws });
  const { ensureDemoWorkspace } = await import("@/lib/services/demo-seed");
  await ensureDemoWorkspace(ws);
  const [idea] = await db.select().from(projectIdeas).where(eq(projectIdeas.workspaceId, ws));
  return idea;
}

describe("Judge's Room streaming", () => {
  it("opens at once, streams the opening question from the quick model and scores alongside", async () => {
    const ws = `ws_${"c3".repeat(16)}`;
    const idea = await demoIdea(ws);
    const { startDebate, openDebate, getDebateBundle } = await import("@/lib/services/debates");
    // The demo ideas have rule-based scores, so with AI on the room rescores before the panel speaks.
    const session = await startDebate(ws, { ideaId: idea.id, mode: "critical" });
    expect(session.currentAssessmentId).toBeNull();
    expect((await getDebateBundle(ws, session.id))!.turns).toHaveLength(0);

    const events: { type: string; key?: string; status?: string; text?: string; detail?: string }[] = [];
    await openDebate(ws, session.id, (e) => events.push(e));
    const texts = events.filter((e) => e.type === "opening").map((e) => e.text!);
    expect(texts.length).toBeGreaterThan(3); // arrived in pieces
    expect(texts.every((t) => OPENING.startsWith(t))).toBe(true);
    expect(texts.at(-1)).toBe(OPENING);
    expect(events.some((e) => e.key === "assessment" && e.status === "running" && /criteria scored/.test(e.detail ?? ""))).toBe(true);
    expect(events.filter((e) => e.type === "step" && e.status === "done").map((e) => e.key).sort()).toEqual(["assessment", "opening"]);

    const opening = callsFor("verdict_opening")[0];
    expect(opening.model).toBe("gpt-5-mini");
    expect(opening.stream).toBe(true);
    expect(callsFor("verdict_assessment")[0].model).toBe("gpt-5");

    const b = (await getDebateBundle(ws, session.id))!;
    expect(b.turns.map((t) => t.text)).toEqual([OPENING]);
    expect(b.current?.method).toBe("ai");
    expect(b.session.initialAssessmentId).toBe(b.current?.id);
    expect(b.session.openingUntil).toBeNull(); // lease released
  });

  it("streams each reply as it is written", async () => {
    const ws = `ws_${"d4".repeat(16)}`;
    const idea = await demoIdea(ws);
    const { startDebate, openDebate, addDebateTurn } = await import("@/lib/services/debates");
    const session = await startDebate(ws, { ideaId: idea.id, mode: "critical" });
    await openDebate(ws, session.id);
    const events: { type: string; text?: string; role?: string }[] = [];
    const r = await addDebateTurn(ws, session.id, { text: "Last month I ran 11 interviews and writing feedback took about 4 hours." }, (e) => events.push(e));
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.map((d) => d.text).join("")).toBe(REPLY);
    expect(events.find((e) => e.type === "role")?.role).toBe("user_advocate");
    expect(events.findIndex((e) => e.type === "role")).toBeLessThan(events.findIndex((e) => e.type === "delta"));
    expect(r.judgeTurn.text).toBe(REPLY);
    expect(r.method).toBe("ai");
  });

  it("an answer sent before scoring finishes waits for it instead of failing", async () => {
    const ws = `ws_${"e5".repeat(16)}`;
    const idea = await demoIdea(ws);
    const { startDebate, addDebateTurn, getDebateBundle } = await import("@/lib/services/debates");
    const session = await startDebate(ws, { ideaId: idea.id, mode: "critical" });
    const events: { type: string; text?: string }[] = [];
    await addDebateTurn(ws, session.id, { text: "We lose about two hours a week to this." }, (e) => events.push(e));
    expect(events[0]).toEqual({ type: "status", text: "Waiting for the rubric scores to finish…" });
    const b = (await getDebateBundle(ws, session.id))!;
    expect(b.current?.method).toBe("ai");
    expect(b.turns.map((t) => t.speaker)).toEqual(["judge", "user", "judge"]);
  });

  it("only one request opens a room at a time", async () => {
    const ws = `ws_${"f6".repeat(16)}`;
    const idea = await demoIdea(ws);
    const { startDebate, openDebate } = await import("@/lib/services/debates");
    const session = await startDebate(ws, { ideaId: idea.id, mode: "critical" });
    const [a, b] = await Promise.all([openDebate(ws, session.id), openDebate(ws, session.id)]);
    expect([a.busy, b.busy].sort()).toEqual([false, true]);
    expect(callsFor("verdict_opening")).toHaveLength(1);
  });
});

describe("active hackathon after its deadline", () => {
  it("moves to the upcoming hackathon closing soonest, unless the visitor chose the past one", async () => {
    const db = await getDb();
    const ws = `ws_${"a7".repeat(16)}`;
    await db.insert(workspaces).values({ id: ws });
    const day = 86_400_000;
    await db.insert(hackathons).values([
      { id: "hack_past0000000001", workspaceId: ws, name: "OpenMetadata Hackathon", deadlineAt: new Date(Date.now() - 180 * day) },
      { id: "hack_soon0000000002", workspaceId: ws, name: "Flip the Switch Hackathon", deadlineAt: new Date(Date.now() + 10 * day) },
      { id: "hack_late0000000003", workspaceId: ws, name: "Later Hackathon", deadlineAt: new Date(Date.now() + 40 * day) },
      { id: "hack_none0000000004", workspaceId: ws, name: "Unverified Hackathon", deadlineAt: null },
    ]);
    const { dismissSwitchNotice, resolveActiveHackathon, setActiveHackathon } = await import("@/lib/services/hackathons");
    const row = async () => (await db.select().from(workspaces).where(eq(workspaces.id, ws)))[0];

    await setActiveHackathon(ws, "hack_past0000000001");
    const r = await resolveActiveHackathon(await row());
    expect(r.active?.name).toBe("Flip the Switch Hackathon");
    expect(r.switchedFrom).toEqual({ id: "hack_past0000000001", name: "OpenMetadata Hackathon" });
    expect((await row()).activeHackathonId).toBe("hack_soon0000000002");

    // The switch stays announced on later pages until dismissed; the upcoming one stays active.
    const later = await resolveActiveHackathon(await row());
    expect(later.active?.id).toBe("hack_soon0000000002");
    expect(later.switchedFrom?.name).toBe("OpenMetadata Hackathon");
    await dismissSwitchNotice(ws);
    expect((await resolveActiveHackathon(await row())).switchedFrom).toBeNull();

    // A past one the visitor picked with "Make active" stays.
    await setActiveHackathon(ws, "hack_past0000000001", { pinned: true });
    const pinned = await resolveActiveHackathon(await row());
    expect(pinned.active?.id).toBe("hack_past0000000001");
    expect(pinned.switchedFrom).toBeNull();

    // An unverified deadline isn't "past", so it isn't replaced either.
    await setActiveHackathon(ws, "hack_none0000000004");
    expect((await resolveActiveHackathon(await row())).active?.id).toBe("hack_none0000000004");
  });

  it("keeps a past hackathon when nothing upcoming has been researched", async () => {
    const db = await getDb();
    const ws = `ws_${"b8".repeat(16)}`;
    await db.insert(workspaces).values({ id: ws });
    await db.insert(hackathons).values({ id: "hack_past0000000009", workspaceId: ws, name: "Old Hackathon", deadlineAt: new Date("2026-04-26T23:59:00Z") });
    const { resolveActiveHackathon, setActiveHackathon } = await import("@/lib/services/hackathons");
    await setActiveHackathon(ws, "hack_past0000000009");
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, ws));
    expect((await resolveActiveHackathon(w)).active?.id).toBe("hack_past0000000009");
  });
});
