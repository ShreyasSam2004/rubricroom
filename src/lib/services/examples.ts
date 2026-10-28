// Example runs: complete RubricRoom sessions on real hackathons, captured by
// scripts/capture-examples.ts (live page retrieval, Atlas, Prism, Verdict, Scout, the Judge's Room,
// Forge and Sprint — the same code paths a visitor uses). A visitor opening an example gets a
// private copy in their own workspace with fresh ids, labelled as a cached example.

import { and, asc, eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import fixture from "@/seed/examples.json";
import { getDb } from "@/lib/db/client";
import {
  assessmentRevisions,
  buildPlans,
  buildTasks,
  claims,
  debateSessions,
  debateTurns,
  demoPlans,
  existingProjects,
  hackathonRules,
  hackathons,
  ideaAssessments,
  ideaVersions,
  judgingCriteria,
  projectIdeas,
  researchJobs,
  researchSources,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/research/jobs";
import { newId } from "@/lib/text";

/** Tables an example run spans, in insert order. Shared with the capture script. */
export const EXAMPLE_TABLES = {
  hackathons,
  research_jobs: researchJobs,
  research_sources: researchSources,
  claims,
  hackathon_rules: hackathonRules,
  judging_criteria: judgingCriteria,
  project_ideas: projectIdeas,
  idea_versions: ideaVersions,
  idea_assessments: ideaAssessments,
  existing_projects: existingProjects,
  debate_sessions: debateSessions,
  debate_turns: debateTurns,
  assessment_revisions: assessmentRevisions,
  build_plans: buildPlans,
  build_tasks: buildTasks,
  demo_plans: demoPlans,
} satisfies Record<string, PgTable>;

export type ExampleTableName = keyof typeof EXAMPLE_TABLES;

export interface ExampleMeta {
  key: string;
  hackathonName: string;
  platform: string;
  url: string;
  ideaName: string;
  pitchLanguage: string;
  blurb: string;
  capturedAt: string;
  model: string;
  /** Ids inside this example's rows (remapped when copied into a workspace). */
  hackathonId: string;
  ideaId: string;
  sessionId: string | null;
  planId: string | null;
  workspaceId: string;
}

export interface ExampleFixture {
  generatedAt: string;
  generator: string;
  disclosure: string;
  examples: (ExampleMeta & { rows: Partial<Record<ExampleTableName, Record<string, unknown>[]>> })[];
}

const FIXTURE = fixture as unknown as ExampleFixture;

export const EXAMPLE_DISCLOSURE = FIXTURE.disclosure;

export function listExamples() {
  return FIXTURE.examples.map((e) => ({
    key: e.key,
    hackathonName: e.hackathonName,
    platform: e.platform,
    url: e.url,
    ideaName: e.ideaName,
    pitchLanguage: e.pitchLanguage,
    blurb: e.blurb,
    capturedAt: e.capturedAt,
    model: e.model,
  }));
}

export const exampleSeedKey = (key: string) => `example:${key}`;

// newId() ids are `<prefix>_<20 hex>`; workspace ids are `ws_<32 hex>`.
const ID_RE = /\b[a-z]+_(?:[0-9a-f]{32}|[0-9a-f]{20})\b/g;

/** Turn JSON-revived ISO strings back into Dates for timestamp columns. */
export function reviveDates(table: PgTable, row: Record<string, unknown>) {
  for (const [name, col] of Object.entries(getTableColumns(table))) {
    if (col.dataType === "date" && typeof row[name] === "string") row[name] = new Date(row[name] as string);
  }
  return row;
}

type CapturedRows = Partial<Record<string, Record<string, unknown>[]>>;

/**
 * Give captured rows fresh ids for another workspace. Every id that appears anywhere in the rows
 * (columns or JSON) is remapped consistently, so references between rows survive the copy.
 */
export function remapRows<R extends CapturedRows>(captured: R, fromWorkspaceId: string, toWorkspaceId: string) {
  const ids = new Map<string, string>([[fromWorkspaceId, toWorkspaceId]]);
  for (const rows of Object.values(captured)) {
    for (const r of rows ?? []) {
      const id = r.id as string;
      if (!ids.has(id)) ids.set(id, newId(id.slice(0, id.indexOf("_"))));
    }
  }
  const rows = JSON.parse(JSON.stringify(captured).replace(ID_RE, (m) => ids.get(m) ?? m)) as R;
  const map = (id: string | null) => (id ? (ids.get(id) ?? id) : null);
  return { rows, map };
}

/** Copy one example into a workspace with fresh ids. */
export function remapExample(example: ExampleFixture["examples"][number], workspaceId: string) {
  const { rows, map } = remapRows(example.rows, example.workspaceId, workspaceId);
  return { rows, hackathonId: map(example.hackathonId)!, ideaId: map(example.ideaId)!, sessionId: map(example.sessionId), planId: map(example.planId) };
}

export async function findExampleHackathon(workspaceId: string, key: string) {
  const db = await getDb();
  const [h] = await db
    .select()
    .from(hackathons)
    .where(and(eq(hackathons.workspaceId, workspaceId), eq(hackathons.seedKey, exampleSeedKey(key))));
  return h ?? null;
}

/** Idempotent: opens the existing copy if this workspace already has the example. */
export async function ensureExample(workspaceId: string, key: string) {
  const example = FIXTURE.examples.find((e) => e.key === key);
  if (!example) throw new Error("Unknown example.");
  const db = await getDb();
  const existing = await findExampleHackathon(workspaceId, key);
  if (existing) {
    const [idea] = await db.select().from(projectIdeas).where(and(eq(projectIdeas.workspaceId, workspaceId), eq(projectIdeas.hackathonId, existing.id))).orderBy(asc(projectIdeas.createdAt)).limit(1);
    return { hackathonId: existing.id, ideaId: idea?.id ?? null, created: false };
  }
  const copy = remapExample(example, workspaceId);
  await db.transaction(async (tx) => {
    for (const [name, table] of Object.entries(EXAMPLE_TABLES) as [ExampleTableName, PgTable][]) {
      const rows = (copy.rows[name] ?? []).map((r) => reviveDates(table, { ...r, workspaceId }));
      if (name === "hackathons") for (const r of rows) Object.assign(r, { origin: "cached_seed", seedKey: exampleSeedKey(key) });
      if (name === "research_sources" || name === "existing_projects") for (const r of rows) r.cached = true;
      for (let i = 0; i < rows.length; i += 200) await tx.insert(table).values(rows.slice(i, i + 200) as never);
    }
  });
  await logActivity(workspaceId, "demo", `Opened example run: ${example.hackathonName} × ${example.ideaName} (captured ${example.capturedAt.slice(0, 10)})`, `/ideas/${copy.ideaId}`);
  return { hackathonId: copy.hackathonId, ideaId: copy.ideaId, created: true };
}

export async function ensureAllExamples(workspaceId: string) {
  for (const e of FIXTURE.examples) await ensureExample(workspaceId, e.key);
}
