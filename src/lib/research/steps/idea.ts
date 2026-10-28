import { and, desc, eq, isNotNull } from "drizzle-orm";
import { scoutCompare, scoutQueries, scoutReport, shortQuery, type Candidate, type ScoutQuery } from "@/lib/agents/scout";
import { describeAIError } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { existingProjects, ideaVersions, projectIdeas } from "@/lib/db/schema";
import { searchProvider } from "@/lib/env";
import { fetchReadme, searchRepositories } from "@/lib/search/github";
import { searchHackerNews } from "@/lib/search/hn";
import type { SearchHit } from "@/lib/search/types";
import { webSearch } from "@/lib/search/web";
import { canonicalUrl, hostOf, newId, tokenize, truncate } from "@/lib/text";
import type { CoverageItem, IdeaFields } from "@/lib/types";
import { registerJobType, type StepContext, type StepHandler } from "../jobs";
import { cosine } from "../similarity";
import { retrieveSource } from "../sources";

interface StoredCandidate {
  name: string;
  url: string;
  platform: "github" | "hackernews" | "devpost" | "producthunt" | "web";
  snippet: string;
  publishedAt: string | null;
  meta: Record<string, unknown>;
  text?: string;
  sourceId?: string;
  query: string;
}

export async function loadIdeaFields(workspaceId: string, ideaId: string): Promise<IdeaFields | null> {
  const db = await getDb();
  const [idea] = await db.select().from(projectIdeas).where(and(eq(projectIdeas.id, ideaId), eq(projectIdeas.workspaceId, workspaceId)));
  if (!idea) return null;
  const [v] = idea.currentVersionId
    ? await db.select().from(ideaVersions).where(eq(ideaVersions.id, idea.currentVersionId))
    : await db.select().from(ideaVersions).where(eq(ideaVersions.ideaId, ideaId)).orderBy(desc(ideaVersions.version)).limit(1);
  if (!v) return null;
  return {
    name: v.name,
    summary: v.summary,
    userProblem: v.userProblem,
    targetAudience: v.targetAudience,
    workflow: v.workflow,
    features: v.features,
    differentiators: v.differentiators,
    sponsorUsage: v.sponsorUsage,
    techStack: v.techStack,
  };
}

function candidates(ctx: StepContext): StoredCandidate[] {
  return (ctx.state.candidates as StoredCandidate[] | undefined) ?? [];
}

function addCandidates(ctx: StepContext, list: StoredCandidate[]) {
  const existing = candidates(ctx);
  const seen = new Set(existing.map((c) => canonicalUrl(c.url)));
  for (const c of list) {
    const k = canonicalUrl(c.url);
    if (seen.has(k)) continue;
    seen.add(k);
    existing.push(c);
  }
  ctx.state.candidates = existing;
  return existing.length;
}

function platformOf(url: string): StoredCandidate["platform"] {
  const h = hostOf(url);
  if (h === "github.com") return "github";
  if (h.endsWith("devpost.com")) return "devpost";
  if (h === "producthunt.com") return "producthunt";
  if (h === "news.ycombinator.com") return "hackernews";
  return "web";
}

const queries: StepHandler = async (ctx) => {
  const idea = await loadIdeaFields(ctx.workspaceId, ctx.job.ideaId!);
  if (!idea) return { status: "failed", detail: "Idea not found.", fatal: true };
  ctx.state.idea = idea;
  let result: { queries: ScoutQuery[]; method: "ai" | "heuristic" };
  try {
    result = ctx.spend("aiCalls") ? await scoutQueries(ctx.workspaceId, idea) : { queries: (await import("@/lib/agents/scout")).heuristicQueries(idea), method: "heuristic" };
  } catch (err) {
    result = { queries: (await import("@/lib/agents/scout")).heuristicQueries(idea), method: "heuristic" };
    ctx.state.queryNote = `AI query generation unavailable (${await describeAIError(err)}).`;
  }
  ctx.state.queries = result.queries;
  return { status: "done", detail: `${result.queries.length} search angles (${result.method === "ai" ? "Scout AI" : "rule-based"}): ${result.queries.map((q) => `“${q.query}”`).join(", ")}`, counts: { queries: result.queries.length } };
};

const github: StepHandler = async (ctx) => {
  const qs = (ctx.state.queries as ScoutQuery[]).filter((q) => q.angle !== "hackathon").slice(0, 3);
  const all: StoredCandidate[] = [];
  const notes: string[] = [];
  let limited = false;
  for (const q of qs) {
    if (!ctx.spend("githubRequests")) break;
    const r = await searchRepositories(shortQuery(q.query), { perPage: 6 });
    if (r.status === "rate_limited") {
      limited = true;
      notes.push(r.detail ?? "rate limited");
      break;
    }
    if (r.status === "failed") notes.push(r.detail ?? "failed");
    for (const h of r.hits) all.push({ name: h.title, url: h.url, platform: "github", snippet: h.snippet, publishedAt: h.publishedAt, meta: h.meta ?? {}, query: q.query });
  }
  const total = addCandidates(ctx, all);
  const coverage: CoverageItem = {
    key: "github",
    label: "GitHub repositories",
    status: limited && all.length === 0 ? "failed" : limited ? "partial" : all.length ? "verified" : "not_available",
    detail: `${all.length} repositories from ${qs.length} queries${limited ? " (rate limit reached — partial)" : ""}${notes.length ? `. ${notes[0]}` : ""}`,
  };
  return { status: limited && all.length === 0 ? "failed" : "done", detail: coverage.detail, counts: { found: all.length, candidates: total }, coverage: [coverage] };
};

const hackernews: StepHandler = async (ctx) => {
  const qs = (ctx.state.queries as ScoutQuery[]).slice(0, 2);
  const all: StoredCandidate[] = [];
  let failed = 0;
  for (const q of qs) {
    if (!ctx.spend("hnRequests")) break;
    const r = await searchHackerNews(shortQuery(q.query, 2), { tags: "show_hn", hitsPerPage: 6 });
    if (r.status === "failed" || r.status === "rate_limited") failed++;
    for (const h of r.hits) all.push({ name: h.title.replace(/^Show HN:\s*/i, ""), url: h.url, platform: platformOf(h.url), snippet: h.snippet, publishedAt: h.publishedAt, meta: { ...h.meta, viaHackerNews: true }, query: q.query });
  }
  addCandidates(ctx, all);
  const coverage: CoverageItem = {
    key: "hackernews",
    label: "Hacker News (Show HN)",
    status: failed === qs.length ? "failed" : all.length ? "verified" : "not_available",
    detail: `${all.length} Show HN launches from ${qs.length} queries.`,
  };
  return { status: "done", detail: coverage.detail, counts: { found: all.length }, coverage: [coverage] };
};

const web: StepHandler = async (ctx) => {
  if (searchProvider() === "none") {
    return {
      status: "not_configured",
      detail: "No web search provider configured — Devpost, Product Hunt and the open web were NOT searched.",
      coverage: [
        { key: "devpost", label: "Devpost projects", status: "not_configured", detail: "Needs TAVILY_API_KEY or EXA_API_KEY." },
        { key: "producthunt", label: "Product Hunt", status: "not_configured", detail: "Needs TAVILY_API_KEY or EXA_API_KEY." },
        { key: "web", label: "Open web", status: "not_configured", detail: "Needs TAVILY_API_KEY or EXA_API_KEY." },
      ],
    };
  }
  const qs = ctx.state.queries as ScoutQuery[];
  const plan: { key: string; label: string; query: string; domains?: string[] }[] = [
    { key: "devpost", label: "Devpost projects", query: qs[0]?.query ?? "", domains: ["devpost.com"] },
    { key: "devpost", label: "Devpost projects", query: qs.find((q) => q.angle === "problem")?.query ?? qs[1]?.query ?? "", domains: ["devpost.com"] },
    { key: "producthunt", label: "Product Hunt", query: qs[0]?.query ?? "", domains: ["producthunt.com"] },
    { key: "web", label: "Open web", query: qs.find((q) => q.angle === "category")?.query ?? qs[0]?.query ?? "" },
  ];
  const coverage = new Map<string, CoverageItem>();
  const all: StoredCandidate[] = [];
  for (const p of plan) {
    if (!p.query || !ctx.spend("webQueries")) continue;
    const r = await webSearch(p.query, { includeDomains: p.domains, maxResults: 6 });
    const hits = r.hits.filter((h: SearchHit) => (p.key === "devpost" ? /devpost\.com\/software\//.test(h.url) : p.key === "producthunt" ? /producthunt\.com\/(products|posts)\//.test(h.url) : true));
    for (const h of hits) all.push({ name: h.title.replace(/\s*[|–-]\s*(Devpost|Product Hunt)$/i, ""), url: h.url, platform: platformOf(h.url), snippet: h.snippet, publishedAt: h.publishedAt, meta: h.meta ?? {}, query: p.query });
    const prev = coverage.get(p.key);
    coverage.set(p.key, {
      key: p.key,
      label: p.label,
      status: r.status === "ok" || prev?.status === "verified" ? "verified" : r.status === "empty" ? (prev?.status ?? "not_available") : "failed",
      detail: `${(Number(prev?.detail?.split(" ")[0]) || 0) + hits.length} results via ${r.provider}${r.status !== "ok" && r.status !== "empty" ? ` (${r.detail})` : ""}`,
    });
  }
  addCandidates(ctx, all);
  return { status: "done", detail: `${all.length} results from Devpost, Product Hunt and the web.`, counts: { found: all.length }, coverage: [...coverage.values()] };
};

const inspect: StepHandler = async (ctx) => {
  const idea = ctx.state.idea as IdeaFields;
  const ideaTokens = tokenize(`${idea.name} ${idea.summary} ${idea.userProblem} ${idea.workflow} ${idea.features.join(" ")}`);
  const list = candidates(ctx)
    .map((c) => ({ c, rel: cosine(ideaTokens, tokenize(`${c.name} ${c.snippet}`)) }))
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 9)
    .map((x) => x.c);
  let inspected = 0;
  for (const c of list) {
    if (c.platform === "github") {
      const full = c.url.replace(/^https:\/\/github\.com\//, "").split("/").slice(0, 2).join("/");
      if (!ctx.spend("githubRequests")) {
        c.text = c.snippet;
        continue;
      }
      const readme = await fetchReadme(full);
      c.text = `${c.snippet}\n\n${readme ?? ""}`.slice(0, 12_000);
      if (readme) inspected++;
    } else if (ctx.spend("urlFetches")) {
      const r = await retrieveSource({ workspaceId: ctx.workspaceId, url: c.url, ideaId: ctx.job.ideaId, jobId: ctx.job.id });
      c.sourceId = r.row.id;
      c.text = r.ok && r.page ? `${r.page.description ?? ""}\n${r.page.text}`.slice(0, 12_000) : c.snippet;
      if (r.ok) inspected++;
      if (r.ok && r.page?.imageUrl) c.meta.image = r.page.imageUrl;
    } else c.text = c.snippet;
  }
  ctx.state.inspected = list;
  return { status: "done", detail: `Read the actual page or README of ${inspected} of the ${list.length} most relevant results (${candidates(ctx).length} found in total).`, counts: { inspected, considered: list.length } };
};

const compare: StepHandler = async (ctx) => {
  const idea = ctx.state.idea as IdeaFields;
  const list = (ctx.state.inspected as StoredCandidate[]) ?? [];
  if (!list.length) return { status: "skipped", detail: "No candidates to compare." };
  const cands: Candidate[] = list.map((c, i) => ({ ref: i, name: c.name, url: c.url, platform: c.platform, text: c.text ?? c.snippet }));
  let res;
  try {
    if (!ctx.spend("aiCalls")) throw new Error("AI budget for this job is exhausted.");
    res = await scoutCompare(ctx.workspaceId, idea, cands);
  } catch (err) {
    const { heuristicFingerprint, compareIdeaToDocument } = await import("../similarity");
    const { ideaFingerprint, ideaDocText } = await import("@/lib/agents/scout");
    const mine = ideaFingerprint(idea);
    res = {
      method: "heuristic" as const,
      results: cands.map((c) => {
        const fp = heuristicFingerprint(c.text, c.name);
        return { ref: c.ref, relevant: true, fingerprint: fp, capabilities: [], audience: fp.targetUser, implementationEvidence: "", similarity: compareIdeaToDocument(mine, ideaDocText(idea), c.text) };
      }),
    };
    ctx.state.compareNote = `AI comparison unavailable (${await describeAIError(err)}); structural heuristic used.`;
  }
  const db = await getDb();
  await db
    .delete(existingProjects)
    .where(and(eq(existingProjects.workspaceId, ctx.workspaceId), eq(existingProjects.ideaId, ctx.job.ideaId!), isNotNull(existingProjects.researchJobId)));
  const keep = await db.select({ url: existingProjects.url }).from(existingProjects).where(and(eq(existingProjects.workspaceId, ctx.workspaceId), eq(existingProjects.ideaId, ctx.job.ideaId!)));
  const kept = new Set(keep.map((k) => canonicalUrl(k.url)));
  const rows = res.results
    .filter((r) => r.relevant && !kept.has(canonicalUrl(list[r.ref].url)))
    .map((r) => {
      const c = list[r.ref];
      return {
        id: newId("proj"),
        workspaceId: ctx.workspaceId,
        ideaId: ctx.job.ideaId,
        hackathonId: ctx.job.hackathonId,
        researchJobId: ctx.job.id,
        name: truncate(c.name, 120),
        url: c.url,
        repoUrl: c.platform === "github" ? c.url : null,
        sourcePlatform: c.platform,
        description: truncate(c.snippet || c.text || "", 600),
        capabilities: r.capabilities,
        audience: r.audience || null,
        implementationEvidence: r.implementationEvidence || null,
        publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
        lastVerifiedAt: new Date(),
        fingerprint: r.fingerprint,
        similarity: r.similarity,
        sourceIds: c.sourceId ? [c.sourceId] : [],
        imageUrl: typeof c.meta.image === "string" ? c.meta.image : null,
        meta: { ...c.meta, foundBy: c.query },
        verification: c.text && c.text.length > (c.snippet?.length ?? 0) + 40 ? ("verified" as const) : ("partially_verified" as const),
      };
    });
  if (rows.length) await db.insert(existingProjects).values(rows);
  const strong = rows.filter((r) => r.similarity.level === "strong").length;
  const moderate = rows.filter((r) => r.similarity.level === "moderate").length;
  return { status: "done", detail: `${rows.length} relevant project(s) compared (${res.method === "ai" ? "Scout AI + structural check" : "structural heuristic"}): ${strong} strong, ${moderate} moderate overlap.`, counts: { compared: rows.length, strong, moderate } };
};

const report: StepHandler = async (ctx) => {
  const idea = ctx.state.idea as IdeaFields;
  const db = await getDb();
  const projects = await db.select().from(existingProjects).where(and(eq(existingProjects.workspaceId, ctx.workspaceId), eq(existingProjects.ideaId, ctx.job.ideaId!)));
  const fresh = await db.select().from((await import("@/lib/db/schema")).researchJobs).where(eq((await import("@/lib/db/schema")).researchJobs.id, ctx.job.id));
  const coverage = fresh[0]?.coverage ?? [];
  let rep;
  try {
    if (!ctx.spend("aiCalls")) throw new Error("budget");
    rep = await scoutReport(ctx.workspaceId, idea, projects.filter((p) => p.similarity).map((p) => ({ id: p.id, name: p.name, url: p.url, similarity: p.similarity!, capabilities: p.capabilities })), coverage, ctx.job.id);
  } catch {
    const { heuristicReport } = await import("@/lib/agents/scout");
    rep = heuristicReport(idea, projects.filter((p) => p.similarity).map((p) => ({ id: p.id, name: p.name, url: p.url, similarity: p.similarity!, capabilities: p.capabilities })).sort((a, b) => b.similarity.score - a.similarity.score), coverage, ctx.job.id);
  }
  await db.update(projectIdeas).set({ originality: rep, updatedAt: new Date() }).where(and(eq(projectIdeas.id, ctx.job.ideaId!), eq(projectIdeas.workspaceId, ctx.workspaceId)));
  return { status: "done", detail: `Originality report written (confidence: ${rep.confidence.level}).` };
};

registerJobType(
  "idea_research",
  [
    { key: "queries", label: "Generate search angles", agent: "scout", phase: "searching_projects" },
    { key: "github", label: "Search GitHub repositories", agent: "scout", phase: "searching_projects" },
    { key: "hackernews", label: "Search Hacker News launches", agent: "scout", phase: "searching_projects" },
    { key: "web", label: "Search Devpost, Product Hunt and the web", agent: "scout", phase: "searching_projects" },
    { key: "inspect", label: "Read the most relevant pages and READMEs", agent: "scout", phase: "searching_projects" },
    { key: "compare", label: "Compare concept structure", agent: "scout", phase: "evaluating" },
    { key: "report", label: "Write the originality report", agent: "scout", phase: "evaluating" },
  ],
  { queries, github, hackernews, web, inspect, compare, report },
);
