import { z } from "zod";
import { compareIdeas, type ComparableIdea } from "@/lib/agents/prism";
import { apiHandler, zId } from "@/lib/api";
import { getIdeaBundle } from "@/lib/services/ideas";

export const maxDuration = 300;

export const POST = apiHandler(z.object({ ideaIds: z.array(zId).min(2).max(5) }), async ({ workspaceId, body }) => {
  const bundles = (await Promise.all(body.ideaIds.map((id) => getIdeaBundle(workspaceId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getIdeaBundle>>>[];
  const order = ["different", "adjacent", "moderate", "strong"];
  const ideas: ComparableIdea[] = bundles.map((b) => ({
    id: b.idea.id,
    name: b.idea.name,
    summary: b.current.summary,
    problem: b.current.userProblem,
    audience: b.current.targetAudience,
    features: b.current.features,
    weightedTotal: b.latest?.weightedTotal ?? null,
    ratings: (b.latest?.criterionResults ?? []).map((r) => ({ name: r.name, rating: r.rating, weight: r.weight })),
    heuristics: Object.fromEntries(Object.entries(b.latest?.heuristics ?? {}).map(([k, v]) => [k, (v as { rating: number }).rating])),
    strongestOverlap: b.projects.reduce<string | null>((acc, p) => (p.similarity && (!acc || order.indexOf(p.similarity.level) > order.indexOf(acc.split(" ")[0])) ? `${p.similarity.level} (${p.name})` : acc), null),
    personalRelevance: b.idea.personalRelevance?.experiences ?? null,
    evidenceCount: (b.latest?.criterionResults ?? []).reduce((s, r) => s + r.evidence.filter((e) => e.kind === "debate_claim").length, 0),
    feasibility: b.idea.feasibility ? { complexity: b.idea.feasibility.complexity.rating, demoReliability: b.idea.feasibility.demoReliability.rating } : null,
  }));
  return { comparison: await compareIdeas(workspaceId, ideas) };
});
