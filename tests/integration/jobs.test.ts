import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { researchJobs, workspaces } from "@/lib/db/schema";
import { advanceJob, createJob, registerJobType } from "@/lib/research/jobs";
import type { JobType } from "@/lib/types";

const WS = `ws_${"c".repeat(32)}`;
let calls: string[] = [];

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  await db.insert(workspaces).values({ id: WS });
  // Load the real job types first so registering test types doesn't shadow them.
  await import("@/lib/research/steps/event");
  await import("@/lib/research/steps/idea");
  await import("@/lib/research/steps/opportunities");
  registerJobType(
    "test_ok" as JobType,
    [
      { key: "one", label: "One", agent: "scout", phase: "searching_projects" },
      { key: "two", label: "Two", agent: "scout", phase: "evaluating" },
    ],
    {
      one: async (ctx) => {
        calls.push("one");
        ctx.state.seen = 1;
        return { status: "done", detail: "first", coverage: [{ key: "x", label: "X", status: "verified" }] };
      },
      two: async (ctx) => {
        calls.push(`two:${ctx.state.seen}`);
        return { status: "not_configured", detail: "no provider" };
      },
    },
  );
  registerJobType("test_fatal" as JobType, [{ key: "a", label: "A", agent: "atlas", phase: "fetching_sources" }, { key: "b", label: "B", agent: "atlas", phase: "extracting" }], {
    a: async () => ({ status: "failed", detail: "nothing retrievable", fatal: true }),
    b: async () => {
      calls.push("b-should-not-run");
      return { status: "done" };
    },
  });
});

afterAll(async () => {
  await resetDbForTests();
});

describe("durable research jobs", () => {
  it("runs exactly one step per advance and persists state between requests", async () => {
    calls = [];
    const job = await createJob({ workspaceId: WS, jobType: "test_ok" as JobType });
    const j1 = (await advanceJob(WS, job.id))!;
    expect(calls).toEqual(["one"]);
    expect(j1.steps.map((s) => s.status)).toEqual(["done", "pending"]);
    expect(j1.state.seen).toBe(1);
    const j2 = (await advanceJob(WS, job.id))!;
    expect(calls).toEqual(["one", "two:1"]);
    expect(j2.status).toBe("partial"); // a not_configured step means partial, never "complete"
    expect(j2.coverage.map((c) => c.key)).toEqual(["x"]);
    await advanceJob(WS, job.id);
    expect(calls).toHaveLength(2); // terminal jobs don't re-run
  });

  it("does not run a step while another request holds the lease", async () => {
    calls = [];
    const job = await createJob({ workspaceId: WS, jobType: "test_ok" as JobType });
    const db = await getDb();
    await db.update(researchJobs).set({ lockedUntil: sql`now() + interval '60 seconds'` }).where(eq(researchJobs.id, job.id));
    const j = (await advanceJob(WS, job.id))!;
    expect(calls).toEqual([]);
    expect(j.steps[0].status).toBe("pending");
  });

  it("fails the job and skips the rest when a required step fails", async () => {
    calls = [];
    const job = await createJob({ workspaceId: WS, jobType: "test_fatal" as JobType });
    const j = (await advanceJob(WS, job.id))!;
    expect(j.status).toBe("failed");
    expect(j.error).toBe("nothing retrievable");
    expect(j.steps.map((s) => s.status)).toEqual(["failed", "skipped"]);
    expect(calls).toEqual([]);
  });

  it("is scoped to the workspace", async () => {
    const job = await createJob({ workspaceId: WS, jobType: "test_ok" as JobType });
    expect(await advanceJob(`ws_${"d".repeat(32)}`, job.id)).toBeNull();
  });
});
