/**
 * Capture the sample workspace a first-time visitor lands in. It starts from the cached
 * WeMakeDevs × Wispr Flow demo (dossier + three sample ideas) and runs RubricRoom's real agents on
 * it — Verdict assessments, Scout competitor research, Forge feasibility, two Judge's Room
 * sessions, a Sprint build plan and demo script, an Opportunity Radar run — in a throwaway
 * database, then writes every resulting row to src/seed/showcase.json.
 * The participant's answers, the ticked tasks and the evidence note below are written for the sample.
 *
 *   npx tsx --env-file=.env.local scripts/capture-showcase.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SELECTED = "Freelance Proposal Agent";

const SESSIONS: { idea: string; mode: "critical" | "technical"; answers: { text: string; apply?: boolean }[] }[] = [
  {
    idea: "Freelance Proposal Agent",
    mode: "critical",
    answers: [
      { text: "I freelance as a web developer. Last month I sent nine proposals on Upwork and each took me about forty minutes, mostly rewriting the same paragraphs about my past projects. I won two of them." },
      { text: "Upwork's own AI proposal helper writes generic text from the job post. Mine starts from my own past projects and rates, so every proposal quotes work I actually shipped, and I fix it by voice before sending." },
      { text: "One correction: there's no Upwork integration in the MVP. It's a web app where I paste or dictate the brief, and the agent drafts the proposal from my saved portfolio.", apply: true },
    ],
  },
  {
    idea: "AI Interview Academy",
    mode: "technical",
    answers: [
      { text: "Judges will love this. Interview prep is a huge market and it will definitely go viral." },
      { text: "Fair point on scope. Remove the video calls from the MVP and focus on the coding tests and the personalised dashboard." },
    ],
  },
];

const EVIDENCE = {
  deliverableKey: "description",
  title: "Short description (draft)",
  notes:
    "Freelance Proposal Agent turns a client's brief into a tailored proposal built from the freelancer's own past projects and rates. Problem: freelancers rewrite near-identical proposals for every lead. Who it's for: independent freelancers who bid on several projects a week. Wispr Flow: the brief, the edits and the final tweaks are all dictated.",
};

const DISCLOSURE =
  "This sample workspace is a real RubricRoom run on the WeMakeDevs × Wispr Flow challenge: the dossier comes from a cached copy of the official pages, and the assessments, competitor research, feasibility reviews, judge replies, opportunity cards, build plan and demo script are the agents' actual output. The three ideas, the participant's answers in the Judge's Room, the ticked tasks and the evidence note were written to demonstrate the product — they are samples, not a real team's work.";

/**
 * Every visitor gets a copy of the sample, so keep it small: a competitor page's full text is only
 * read while Scout runs (the overlaps keep their own quotes), so an excerpt is enough. The official
 * event pages keep their full text; a re-run of the research reads them.
 */
export function trimCompetitorText(sources: Record<string, unknown>[] = []) {
  for (const s of sources) if (s.ideaId && typeof s.extractedText === "string") s.extractedText = s.extractedText.slice(0, 1500);
}

async function main() {
  const dbDir = path.join(os.tmpdir(), `rubricroom-showcase-${Date.now()}`);
  process.env.PGLITE_DIR = dbDir; // throwaway database; read lazily on first getDb()

  const { getDb } = await import("../src/lib/db/client");
  const schema = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { aiModel, aiProvider } = await import("../src/lib/env");
  const { ensureDemoWorkspace } = await import("../src/lib/services/demo-seed");
  const { assessCurrentVersion, listIdeas, refreshFeasibility, selectIdea } = await import("../src/lib/services/ideas");
  const { addDebateTurn, openDebate, resolveIdeaUpdate, startDebate } = await import("../src/lib/services/debates");
  const { createDemo, createPlan, getPlanBundle, updateTask } = await import("../src/lib/services/plans");
  const { addEvidence } = await import("../src/lib/services/evidence");
  const { advanceJob, createJob, isTerminal } = await import("../src/lib/research/jobs");
  const { SHOWCASE_TABLES } = await import("../src/lib/services/showcase");

  if (aiProvider() === "none") throw new Error("Capture needs an AI provider so the sample shows real agent output.");
  const model = aiProvider() === "openai" ? `OpenAI ${aiModel()}` : `Claude (${aiModel()})`;
  const db = await getDb();
  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  async function runJob(ws: string, jobId: string, label: string) {
    for (let i = 0; i < 200; i++) {
      const job = await advanceJob(ws, jobId);
      if (!job) throw new Error(`${label}: job vanished`);
      if (isTerminal(job.status)) {
        log(`  ${label}: ${job.status}${job.error ? ` (${job.error})` : ""}`);
        return job;
      }
    }
    throw new Error(`${label}: did not finish`);
  }

  const ws = `ws_${crypto.randomBytes(16).toString("hex")}`;
  await db.insert(schema.workspaces).values({ id: ws });
  const { hackathonId } = await ensureDemoWorkspace(ws);
  const ideas = await listIdeas(ws, hackathonId);
  const byName = (name: string) => ideas.find((i) => i.idea.name === name)!.idea.id;
  log(`cached demo: ${ideas.length} sample ideas`);

  for (const { idea } of ideas) {
    await assessCurrentVersion(ws, idea.id, { reason: "Verdict assessment" });
    await refreshFeasibility(ws, idea.id);
    const research = await createJob({ workspaceId: ws, jobType: "idea_research", ideaId: idea.id, hackathonId });
    await runJob(ws, research.id, `${idea.name}: competitor research (Scout)`);
    log(`  ${idea.name}: Verdict + Forge + Scout`);
  }

  const sessionIds: string[] = [];
  for (const s of SESSIONS) {
    const session = await startDebate(ws, { ideaId: byName(s.idea), mode: s.mode });
    await openDebate(ws, session.id);
    for (const a of s.answers) {
      const t = await addDebateTurn(ws, session.id, { text: a.text });
      if (a.apply && t.judgeTurn.ideaUpdate?.status === "proposed") await resolveIdeaUpdate(ws, t.judgeTurn.id, "apply");
    }
    sessionIds.push(session.id);
    log(`  Judge's Room: ${s.idea} (${s.answers.length} answers)`);
  }

  const selectedId = byName(SELECTED);
  await selectIdea(ws, selectedId);
  const planId = await createPlan(ws, selectedId);
  await createDemo(ws, selectedId, {});
  const plan = (await getPlanBundle(ws, planId))!;
  for (const t of [...plan.tasks].sort((a, b) => a.day - b.day || a.position - b.position).slice(0, 2)) await updateTask(ws, t.id, { status: "done" });
  await addEvidence(ws, { hackathonId, ideaId: selectedId, deliverableKey: EVIDENCE.deliverableKey, artifactType: "note", title: EVIDENCE.title, notes: EVIDENCE.notes });
  log("  build plan + demo script + evidence note");

  const radar = await createJob({ workspaceId: ws, jobType: "opportunities", hackathonId, input: { mode: "unsolved", modifiers: ["less_crowded", "easier"], request: null, baseIdeaId: null, count: 4 } });
  await runJob(ws, radar.id, "Opportunity Radar (Nova)");

  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const [name, table] of Object.entries(SHOWCASE_TABLES)) {
    const all = (await db.select().from(table as typeof schema.hackathons).where(eq((table as typeof schema.hackathons).workspaceId, ws))) as Record<string, unknown>[];
    // Finished jobs keep their steps and coverage; intermediate step state is not needed.
    rows[name] = name === "research_jobs" ? all.map((r) => ({ ...r, state: {}, lockedUntil: null })) : all;
  }
  trimCompetitorText(rows.research_sources);
  const fixture = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/capture-showcase.ts",
    model,
    disclosure: DISCLOSURE,
    workspaceId: ws,
    hackathonId,
    activeIdeaId: selectedId,
    sessionIds,
    planId,
    rows,
  };
  const outFile = path.join(process.cwd(), "src", "seed", "showcase.json");
  fs.writeFileSync(outFile, JSON.stringify(fixture));
  log(`Wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
  for (const [name, r] of Object.entries(rows)) if (r.length) log(`  ${name}: ${r.length}`);
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    log(`(left the throwaway database at ${dbDir})`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
