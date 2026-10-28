// Scout — Competition Researcher. Generates varied search angles, fingerprints discovered projects
// from their actual page/README text, compares concept structure (not titles) and reports limits.

import { z } from "zod";
import { generateStructured, isAIConfigured, UNTRUSTED_POLICY, wrapUntrusted } from "@/lib/ai";
import { compareIdeaToDocument, heuristicFingerprint, LEVEL_LABEL } from "@/lib/research/similarity";
import { tokenize, truncate, uniqueBy } from "@/lib/text";
import type { CoverageItem, IdeaFields, OriginalityReport, OverlapLevel, ProjectFingerprint, SimilarityResult } from "@/lib/types";

export type QueryAngle = "exact" | "terminology" | "problem" | "workflow" | "technology" | "category" | "domain" | "hackathon" | "open_source";

export interface ScoutQuery {
  query: string;
  angle: QueryAngle;
}

export const QuerySchema = z.object({
  queries: z.array(
    z.object({
      query: z.string().describe("A concise search query (3-7 words), no quotes or site: operators."),
      angle: z.enum(["exact", "terminology", "problem", "workflow", "technology", "category", "domain", "hackathon", "open_source"]),
    }),
  ),
});

const QUERY_STOP = new Set(
  "a an the and or of for to in on at by with from into is are be it its this that these those your their our my you they we who what how when where which while than then also just very more most less each every can could should would will one two any all some many much such via using use used based app tool tools platform system product web page site way thing things user users people let lets turn turns help helps make makes get gets new real time hours spend spending still even".split(" "),
);

/** Distinctive, *unstemmed* words in order of how often the idea uses them. */
function keyTerms(idea: IdeaFields): string[] {
  const text = [idea.name, idea.summary, idea.userProblem, idea.workflow, idea.features.join(" "), idea.targetAudience].join(" ").toLowerCase();
  const counts = new Map<string, number>();
  for (const w of text.match(/[\p{L}][\p{L}\p{N}+#.-]{2,}/gu) ?? []) {
    const word = w.replace(/[.-]+$/, "");
    if (word.length < 3 || QUERY_STOP.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const nameWord = idea.name.toLowerCase();
  return [...counts.entries()].filter(([w]) => w !== nameWord).sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

/**
 * Deterministic query expansion: never just the title. Short (2–3 word) queries, because code
 * search engines AND every term — five-word queries usually match nothing.
 */
export function heuristicQueries(idea: IdeaFields): ScoutQuery[] {
  const terms = keyTerms(idea);
  const domain = terms[0];
  if (!domain) return [];
  const without = (text: string, n: number) =>
    (text.toLowerCase().match(/[\p{L}][\p{L}\p{N}+#-]{2,}/gu) ?? [])
      .map((w) => w.replace(/'s$/, ""))
      .filter((w) => w !== domain && !QUERY_STOP.has(w) && !GENERIC_QUERY.has(w))
      .slice(0, n)
      .join(" ");
  const q: ScoutQuery[] = [];
  // The concept itself: domain + what it does, taken from each feature.
  for (const [i, f] of idea.features.slice(0, 4).entries()) {
    const rest = without(f, 2);
    if (rest) q.push({ query: `${domain} ${rest}`, angle: i === 0 ? "exact" : "category" });
  }
  if (idea.userProblem) {
    const rest = without(idea.userProblem, 2);
    if (rest) q.push({ query: `${domain} ${rest}`, angle: "problem" });
  }
  const distinctive = terms.slice(1).filter((t) => !GENERIC_QUERY.has(t));
  if (distinctive[0]) q.push({ query: `${domain} ${distinctive[0]}`, angle: "terminology" });
  if (distinctive[1]) q.push({ query: `${domain} ${distinctive[1]} tool`, angle: "workflow" });
  if (idea.techStack.length) q.push({ query: `${idea.techStack[0].toLowerCase()} ${domain} ${distinctive[0] ?? ""}`.trim(), angle: "technology" });
  return uniqueBy(
    q.filter((x) => x.query.trim().split(/\s+/).length >= 2),
    (x) => x.query.toLowerCase(),
  ).slice(0, 8);
}

/** Words that describe *any* project — useless for finding similar ones. */
const GENERIC_QUERY = new Set(
  "build building built event events participant participants reading read url cited citations solo small team teams deciding decide want need project projects across first across voice-first aware deadline-aware dossier board submission based fast simple easy better good great best".split(" "),
);

/**
 * Code search ANDs every term, so a natural-language query ("AI hackathon idea evaluator against
 * judging rubric") usually matches nothing. Keep only the first few distinctive words.
 */
export function shortQuery(query: string, max = 3): string {
  const words = (query.toLowerCase().match(/[\p{L}][\p{L}\p{N}+#.-]{1,}/gu) ?? []).filter((w) => w.length > 2 && !QUERY_STOP.has(w) && !GENERIC_QUERY.has(w) && !["against", "from", "into", "about", "choose", "winning"].includes(w));
  return [...new Set(words)].slice(0, max).join(" ") || query;
}

export async function scoutQueries(workspaceId: string, idea: IdeaFields): Promise<{ queries: ScoutQuery[]; method: "ai" | "heuristic" }> {
  if (!isAIConfigured()) return { queries: heuristicQueries(idea), method: "heuristic" };
  const { data } = await generateStructured({
    agent: "scout",
    workspaceId,
    schemaName: "scout_queries",
    schema: QuerySchema,
    effort: "low",
    maxTokens: 2000,
    system: `You are Scout, the competition-research agent in RubricRoom. Generate 8 varied search queries to find existing projects that overlap with an idea: the exact concept, alternative terminology, the core user problem, the key workflow, enabling technology, the closest product category, domain-specific alternatives, prior hackathon builds, and open-source tools. Never search only the product name.`,
    prompt: JSON.stringify(idea),
  });
  return { queries: uniqueBy(data.queries, (x) => x.query.toLowerCase()).slice(0, 9), method: "ai" };
}

/** Flat text of an idea, for keyword coverage. */
export function ideaDocText(idea: IdeaFields) {
  return [idea.name, idea.summary, idea.userProblem, idea.targetAudience, idea.workflow, idea.features.join(". "), idea.differentiators.join(". ")].join(". ");
}

export function ideaFingerprint(idea: IdeaFields): ProjectFingerprint {
  const auto = heuristicFingerprint(`${idea.summary}. ${idea.workflow}. ${idea.features.join(". ")}`, idea.name);
  return {
    targetUser: idea.targetAudience || auto.targetUser,
    problem: idea.userProblem || idea.summary,
    workflow: idea.workflow || auto.workflow || idea.summary,
    input: auto.input,
    transformation: auto.transformation || idea.summary,
    output: auto.output,
    technology: [...idea.techStack, idea.sponsorUsage].filter(Boolean).join(", ") || auto.technology,
    delivery: auto.delivery || "web app",
    keywords: tokenize(`${idea.name} ${idea.summary} ${idea.userProblem} ${idea.features.join(" ")}`).slice(0, 24),
  };
}

export interface Candidate {
  ref: number;
  name: string;
  url: string;
  platform: string;
  text: string;
}

export interface CandidateAnalysis {
  ref: number;
  fingerprint: ProjectFingerprint;
  capabilities: string[];
  audience: string;
  implementationEvidence: string;
  similarity: SimilarityResult;
}

const FpSchema = z.object({
  targetUser: z.string(),
  problem: z.string(),
  workflow: z.string(),
  input: z.string(),
  transformation: z.string(),
  output: z.string(),
  technology: z.string(),
  delivery: z.string(),
  keywords: z.array(z.string()),
});

export const ScoutCompareSchema = z.object({
  projects: z.array(
    z.object({
      ref: z.number().int(),
      relevant: z.boolean().describe("false if the page is not actually a product/project (e.g. a listicle, unrelated page)."),
      fingerprint: FpSchema,
      capabilities: z.array(z.string()).describe("Capabilities the TEXT says the project has. Do not infer."),
      audience: z.string(),
      implementationEvidence: z.string().describe("What in the text shows it was actually built (demo, repo, screenshots), or 'not shown in reviewed text'."),
      level: z.enum(["strong", "moderate", "adjacent", "different"]),
      overlaps: z.array(z.string()),
      differences: z.array(z.string()).describe("Phrase absences as 'not described in the reviewed page', never as 'lacks'."),
    }),
  ),
});

const LEVEL_SCORE: Record<OverlapLevel, number> = { strong: 0.72, moderate: 0.45, adjacent: 0.25, different: 0.08 };

export async function scoutCompare(workspaceId: string, idea: IdeaFields, candidates: Candidate[]): Promise<{ results: (CandidateAnalysis & { relevant: boolean })[]; method: "ai" | "heuristic" }> {
  const mine = ideaFingerprint(idea);
  const heuristic = candidates.map((c) => {
    const fp = heuristicFingerprint(c.text, c.name);
    return { ref: c.ref, fingerprint: fp, sim: compareIdeaToDocument(mine, ideaDocText(idea), c.text) };
  });
  if (!isAIConfigured() || candidates.length === 0) {
    return {
      method: "heuristic",
      results: heuristic.map((h) => {
        const c = candidates.find((x) => x.ref === h.ref)!;
        return {
          ref: h.ref,
          relevant: true,
          fingerprint: h.fingerprint,
          capabilities: h.fingerprint.transformation ? [h.fingerprint.transformation] : [],
          audience: h.fingerprint.targetUser,
          implementationEvidence: c.platform === "github" ? "Public repository (README reviewed)." : c.platform === "devpost" ? "Devpost submission page reviewed." : "Product page reviewed.",
          similarity: h.sim,
        };
      }),
    };
  }
  const blocks = candidates.map((c) => wrapUntrusted({ ref: c.ref, name: c.name, url: c.url, platform: c.platform }, c.text, 7000)).join("\n\n");
  const { data } = await generateStructured({
    agent: "scout",
    workspaceId,
    schemaName: "scout_compare",
    schema: ScoutCompareSchema,
    effort: "medium",
    maxTokens: 12_000,
    system: `You are Scout, comparing a participant's idea with discovered projects. Compare concept STRUCTURE — target user, problem, workflow, input, transformation, output, technology, delivery — not titles. Two projects with similar names but different problems are "different". Use only the provided text; do not claim a project failed, was abandoned, or lacks a feature unless the text says so. ${UNTRUSTED_POLICY}`,
    prompt: `IDEA:\n${JSON.stringify(idea)}\n\nDISCOVERED PROJECTS:\n${blocks}`,
  });
  const results = candidates.map((c) => {
    const ai = data.projects.find((p) => p.ref === c.ref);
    const h = heuristic.find((x) => x.ref === c.ref)!;
    if (!ai) return { ref: c.ref, relevant: true, fingerprint: h.fingerprint, capabilities: [], audience: h.fingerprint.targetUser, implementationEvidence: "not analyzed", similarity: h.sim };
    const structural = compareIdeaToDocument(mine, ideaDocText(idea), c.text);
    const score = Math.round((LEVEL_SCORE[ai.level] * 0.6 + structural.score * 0.4) * 100) / 100;
    return {
      ref: c.ref,
      relevant: ai.relevant,
      fingerprint: ai.fingerprint,
      capabilities: ai.capabilities,
      audience: ai.audience,
      implementationEvidence: ai.implementationEvidence,
      similarity: { ...structural, score, level: ai.level, overlaps: ai.overlaps, differences: ai.differences, method: "ai" as const },
    };
  });
  return { results, method: "ai" };
}

// ---------------------------------------------------------------- originality report

export interface ReportProject {
  id: string;
  name: string;
  url: string;
  similarity: SimilarityResult;
  capabilities: string[];
}

export const ReportSchema = z.object({
  closest: z.array(z.object({ projectId: z.string(), why: z.string() })),
  overlappingFeatures: z.array(z.string()),
  gaps: z.array(z.string()).describe("What appears underserved IN THE REVIEWED EVIDENCE."),
  differentiation: z.array(z.string()),
  limitations: z.array(z.string()),
  confidence: z.object({ level: z.enum(["broad", "moderate", "narrow", "minimal"]), explanation: z.string() }),
  dimensions: z.object({
    workflowNovelty: z.object({ rating: z.number().int(), rationale: z.string() }),
    technicalNovelty: z.object({ rating: z.number().int(), rationale: z.string() }),
    framingNovelty: z.object({ rating: z.number().int(), rationale: z.string() }),
    uncommonCombination: z.object({ rating: z.number().int(), rationale: z.string() }),
    differentiationStrength: z.object({ rating: z.number().int(), rationale: z.string() }),
  }),
});

function coverageLimitations(coverage: CoverageItem[]) {
  const lim = coverage.filter((c) => c.status !== "verified" && c.status !== "partial").map((c) => `${c.label}: ${c.status.replace("_", " ")}${c.detail ? ` — ${c.detail}` : ""}`);
  lim.push("Private submissions, unindexed projects and closed communities cannot be searched.");
  return lim;
}

export async function scoutReport(workspaceId: string, idea: IdeaFields, projects: ReportProject[], coverage: CoverageItem[], jobId: string | null): Promise<OriginalityReport> {
  const sorted = [...projects].sort((a, b) => b.similarity.score - a.similarity.score);
  const base = heuristicReport(idea, sorted, coverage, jobId);
  if (!isAIConfigured() || projects.length === 0) return base;
  const { data } = await generateStructured({
    agent: "scout",
    workspaceId,
    schemaName: "scout_originality_report",
    schema: ReportSchema,
    effort: "low",
    maxTokens: 5000,
    system: `You are Scout writing an originality report. Use only the provided comparisons. Never say an idea is "X% unique" or "completely original". Absence of evidence is not evidence of uniqueness. Ratings are 0-5 heuristic assessments. Use exact project ids.`,
    prompt: JSON.stringify({
      idea,
      projects: sorted.slice(0, 10).map((p) => ({ id: p.id, name: p.name, level: p.similarity.level, overlaps: p.similarity.overlaps, differences: p.similarity.differences, capabilities: p.capabilities })),
      researchCoverage: coverage,
    }),
  });
  const byId = new Map(projects.map((p) => [p.id, p]));
  return {
    ...base,
    closest: data.closest
      .map((c) => byId.get(c.projectId) && { projectId: c.projectId, name: byId.get(c.projectId)!.name, url: byId.get(c.projectId)!.url, level: byId.get(c.projectId)!.similarity.level, why: c.why })
      .filter(Boolean) as OriginalityReport["closest"],
    overlappingFeatures: data.overlappingFeatures,
    gaps: data.gaps,
    differentiation: data.differentiation,
    limitations: [...new Set([...data.limitations, ...base.limitations])],
    confidence: data.confidence,
    dimensions: data.dimensions,
    method: "ai",
  };
}

export function heuristicReport(idea: IdeaFields, sorted: ReportProject[], coverage: CoverageItem[], jobId: string | null): OriginalityReport {
  const relevant = sorted.filter((p) => p.similarity.level !== "different");
  const searched = coverage.filter((c) => c.status === "verified" || c.status === "partial").length;
  const level: OriginalityReport["confidence"]["level"] = sorted.length >= 8 && searched >= 3 ? "moderate" : sorted.length >= 3 ? "narrow" : "minimal";
  const top = relevant[0];
  const overlapCount = relevant.filter((p) => p.similarity.level === "strong" || p.similarity.level === "moderate").length;
  const dim = (rating: number, rationale: string) => ({ rating: Math.max(0, Math.min(5, rating)), rationale });
  return {
    closest: relevant.slice(0, 3).map((p) => ({ projectId: p.id, name: p.name, url: p.url, level: p.similarity.level, why: p.similarity.overlaps[0] ?? `${LEVEL_LABEL[p.similarity.level]} on the compared dimensions.` })),
    overlappingFeatures: [...new Set(relevant.flatMap((p) => p.similarity.overlaps))].slice(0, 8),
    gaps: idea.differentiators.length && overlapCount === 0 ? idea.differentiators.map((d) => `Not seen in the reviewed projects: ${truncate(d, 120)}`) : [],
    differentiation: idea.differentiators.length ? idea.differentiators : ["State one concrete thing your workflow does that the closest project does not."],
    limitations: coverageLimitations(coverage),
    confidence: {
      level,
      explanation: `${sorted.length} project(s) reviewed across ${searched} source type(s). ${level === "minimal" ? "Too little evidence to judge originality." : "Coverage is partial; more similar projects likely exist."}`,
    },
    dimensions: {
      workflowNovelty: dim(top ? 5 - Math.round((top.similarity.dimensions.workflow > 0 ? top.similarity.dimensions.workflow : 0.3) * 5) : 3, top ? `Closest workflow match: ${top.name}.` : "No comparable workflow found in reviewed sources."),
      technicalNovelty: dim(top ? 5 - Math.round((top.similarity.dimensions.technology > 0 ? top.similarity.dimensions.technology : 0.3) * 5) : 3, "Based on overlap of named technologies."),
      framingNovelty: dim(top ? 5 - Math.round((top.similarity.dimensions.problem > 0 ? top.similarity.dimensions.problem : 0.3) * 5) : 3, "Based on overlap of the stated problem."),
      uncommonCombination: dim(idea.differentiators.length ? 3 : 2, idea.differentiators.length ? "Differentiators claimed; not independently verified." : "No differentiators stated."),
      differentiationStrength: dim(overlapCount === 0 ? 3 : overlapCount <= 2 ? 2 : 1, `${overlapCount} project(s) with strong or moderate overlap.`),
    },
    projectsReviewed: sorted.length,
    method: "heuristic",
    createdAt: new Date().toISOString(),
    jobId,
  };
}
