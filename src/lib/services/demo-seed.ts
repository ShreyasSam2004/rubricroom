// Builds the one-click demo workspace from a cached snapshot of the real WeMakeDevs × Wispr Flow
// pages (fetched by scripts/refresh-seed.ts through RubricRoom's own fetcher). The dossier is
// produced by the same extraction + verification code as live research, and every row is
// labelled as cached with its real retrieval time. Sample ideas are labelled as samples.

import { and, eq } from "drizzle-orm";
import snapshot from "@/seed/wispr-snapshot.json";
import { getDb } from "@/lib/db/client";
import { hackathons, projectIdeas, researchSources, workspaces } from "@/lib/db/schema";
import type { SourceForExtraction } from "@/lib/extract/contract";
import { heuristicExtract } from "@/lib/extract/heuristics";
import { logActivity } from "@/lib/research/jobs";
import { persistExtraction } from "@/lib/research/persist-event";
import { newId } from "@/lib/text";
import type { CoverageItem, IdeaFields, MarkupHint, SourceType } from "@/lib/types";
import { assessCurrentVersion, createIdea } from "./ideas";

export const DEMO_SEED_KEY = "wemakedevs-wispr-2026";

interface SnapshotSource {
  url: string;
  finalUrl: string;
  title: string | null;
  publisher: string;
  sourceType: string;
  authority: number;
  publishedAt: string | null;
  retrievedAt: string;
  httpStatus: number;
  text: string;
  markupHints: MarkupHint[];
  contentHash: string;
  excerpt: string;
}

const SNAP = snapshot as unknown as { generatedAt: string; sources: SnapshotSource[] };

export const SAMPLE_IDEAS: { name: string; fields: IdeaFields; pitch: string }[] = [
  {
    name: "AI Interview Academy",
    pitch: "I want to build an AI interview preparation platform with specialized agents, video calls, coding tests, and a personalized dashboard.",
    fields: {
      name: "AI Interview Academy",
      summary: "An AI interview preparation platform with specialized agents, video calls, coding tests, and a personalized dashboard.",
      userProblem: "Candidates practise interviews without structured feedback.",
      targetAudience: "Job seekers preparing for technical interviews",
      workflow: "Pick a role → run a mock interview with an AI agent → get feedback on a dashboard.",
      features: ["Specialized interviewer agents", "Video calls", "Coding tests", "Personalized dashboard"],
      differentiators: [],
      sponsorUsage: "",
      techStack: [],
    },
  },
  {
    name: "Freelance Proposal Agent",
    pitch: "An agent for freelancers that turns a client brief into a tailored proposal using my past projects, so I stop rewriting the same pitch every time.",
    fields: {
      name: "Freelance Proposal Agent",
      summary: "Turns a client's job brief into a tailored proposal using the freelancer's own past projects and rates.",
      userProblem: "Freelancers rewrite similar proposals for every lead and lose time on unpaid writing.",
      targetAudience: "Independent freelancers who bid on several projects a week",
      workflow: "Paste or dictate the client brief → the agent matches relevant past work → drafts a proposal → the freelancer dictates fixes and sends.",
      features: ["Brief parsing", "Past-work matching", "Proposal drafting", "Voice-dictated revisions"],
      differentiators: [],
      sponsorUsage: "Dictate briefs and revisions with Wispr Flow.",
      techStack: [],
    },
  },
  {
    name: "Finance Content Safety Checker",
    pitch: "A checker for finance creators that flags risky claims in scripts before they post — things like guaranteed returns or unregistered advice.",
    fields: {
      name: "Finance Content Safety Checker",
      summary: "Flags risky claims (e.g. guaranteed returns, implied personal advice) in finance creators' scripts before they publish.",
      userProblem: "Finance creators can unknowingly publish claims that mislead viewers or breach advertising rules.",
      targetAudience: "Personal-finance content creators",
      workflow: "Dictate or paste a script → the checker highlights risky sentences with reasons → creator dictates safer rewrites.",
      features: ["Risky-claim detection", "Explanations with references", "Rewrite suggestions"],
      differentiators: [],
      sponsorUsage: "Scripts and rewrites are dictated with Wispr Flow.",
      techStack: [],
    },
  },
];

export async function findDemoHackathon(workspaceId: string) {
  const db = await getDb();
  const [h] = await db.select().from(hackathons).where(and(eq(hackathons.workspaceId, workspaceId), eq(hackathons.seedKey, DEMO_SEED_KEY)));
  return h ?? null;
}

/** Idempotent: returns the existing demo hackathon if this workspace already has one. */
export async function ensureDemoWorkspace(workspaceId: string) {
  const existing = await findDemoHackathon(workspaceId);
  if (existing) return { hackathonId: existing.id, created: false };
  const db = await getDb();
  const hackathonId = newId("hack");
  await db.insert(hackathons).values({
    id: hackathonId,
    workspaceId,
    name: "No Hands: The Wispr Challenge",
    officialUrl: SNAP.sources[0].url,
    sourceStatus: "partial",
    origin: "cached_seed",
    seedKey: DEMO_SEED_KEY,
  });

  const rows = SNAP.sources.map((s) => ({
    id: newId("src"),
    workspaceId,
    hackathonId,
    url: s.url,
    finalUrl: s.finalUrl,
    title: s.title,
    publisher: s.publisher,
    sourceType: s.sourceType as SourceType,
    authority: s.authority,
    publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
    retrievedAt: new Date(s.retrievedAt),
    excerpt: s.excerpt,
    extractedText: s.text,
    markupHints: s.markupHints,
    contentHash: s.contentHash,
    httpStatus: s.httpStatus,
    status: "retrieved" as const,
    cached: true,
  }));
  await db.insert(researchSources).values(rows);

  const forExtraction: SourceForExtraction[] = rows.map((r, i) => ({
    ref: i,
    sourceId: r.id,
    url: r.finalUrl,
    title: r.title,
    sourceType: r.sourceType,
    authority: r.authority,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    retrievedAt: r.retrievedAt.toISOString(),
    text: r.extractedText,
    markupHints: r.markupHints,
  }));
  const extraction = heuristicExtract(forExtraction, new Date(SNAP.generatedAt));
  await persistExtraction({
    workspaceId,
    hackathonId,
    sources: forExtraction,
    extraction,
    method: "heuristic",
    notes: [`Cached demo dossier: ${rows.length} official pages retrieved by RubricRoom on ${SNAP.generatedAt.slice(0, 16).replace("T", " ")} UTC and extracted with the deterministic parser. Use “Re-run live research” for a fresh retrieval${""}.`],
  });
  const coverage: CoverageItem[] = [
    { key: "official_pages", label: "Official pages inspected", status: "verified", detail: `${rows.length} pages (cached ${SNAP.generatedAt.slice(0, 10)})` },
    { key: "rules_document", label: "Rules document retrieved", status: "not_available", detail: "No separate rules document was found; rules come from the event, judging and schedule pages." },
    { key: "rubric", label: "Rubric verified", status: "verified", detail: `${extraction.criteria.length} criteria; weights recovered from page markup (the page animates them from 0%).` },
    { key: "submission_page", label: "Submission requirements found", status: extraction.submission.length ? "verified" : "not_available", detail: `${extraction.submission.length} required deliverables` },
    { key: "public_submissions", label: "Public submissions inspected", status: "not_searched", detail: "No public project gallery was inspected for this cached demo." },
    { key: "competitor_research", label: "External competitor research", status: "not_searched", detail: "Run competitor research on an idea to search GitHub, Hacker News and Devpost." },
  ];
  await db.update(hackathons).set({ coverage, sourceStatus: "partial", updatedAt: new Date() }).where(eq(hackathons.id, hackathonId));

  // Sample ideas, labelled as samples.
  for (const s of SAMPLE_IDEAS) await createIdea(workspaceId, { hackathonId, fields: s.fields, pitch: s.pitch, name: s.name, origin: "sample" });

  // Initial rule-based assessments (instant, labelled); the Judge's Room reassesses with AI when configured.
  const ideas = await db.select().from(projectIdeas).where(and(eq(projectIdeas.workspaceId, workspaceId), eq(projectIdeas.hackathonId, hackathonId)));
  // Rule-based here so the demo opens instantly; the Judge's Room upgrades to Verdict (AI) when a key is configured.
  for (const i of ideas) await assessCurrentVersion(workspaceId, i.id, { reason: "Initial rule-based assessment", forceHeuristic: true }).catch(() => undefined);

  // Opening the demo is an explicit choice, so it stays active after its deadline too.
  await db.update(workspaces).set({ activeHackathonId: hackathonId, activeIdeaId: null, activePinned: true }).where(eq(workspaces.id, workspaceId));
  await logActivity(workspaceId, "demo", "Opened the live demo: WeMakeDevs × Wispr Flow (cached dossier)", `/hackathons/${hackathonId}`);
  return { hackathonId, created: true };
}
