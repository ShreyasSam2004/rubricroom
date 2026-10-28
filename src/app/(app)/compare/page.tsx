import { eq } from "drizzle-orm";
import { CompareArena, type CompareIdea } from "@/components/ideas/compare-arena";
import { PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { existingProjects } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { WEIGHT_BASIS_LABEL } from "@/lib/scoring";
import { listIdeas } from "@/lib/services/ideas";
import type { OverlapLevel } from "@/lib/types";

export const metadata = { title: "Idea Comparison" };

export default async function ComparePage() {
  const { workspaceId, active } = await pageContext();
  const all = (await listIdeas(workspaceId)).filter((i) => i.idea.status !== "archived");
  const scoped = active ? all.filter((i) => i.idea.hackathonId === active.id) : all;
  const list = scoped.length >= 2 ? scoped : all;
  const db = await getDb();
  const projects = await db.select().from(existingProjects).where(eq(existingProjects.workspaceId, workspaceId));
  const order: OverlapLevel[] = ["different", "adjacent", "moderate", "strong"];
  const ideas: CompareIdea[] = list.map(({ idea, version, assessment }) => {
    const reviewed = projects.filter((p) => p.ideaId === idea.id && p.similarity);
    const mine = reviewed.filter((p) => p.similarity!.level !== "different").sort((a, b) => order.indexOf(b.similarity!.level) - order.indexOf(a.similarity!.level) || b.similarity!.score - a.similarity!.score);
    return {
      id: idea.id,
      name: idea.name,
      status: idea.status,
      origin: idea.origin,
      problem: version?.userProblem ?? "",
      audience: version?.targetAudience ?? "",
      sponsorUsage: version?.sponsorUsage ?? "",
      features: version?.features ?? [],
      personal: idea.personalRelevance?.experiences ?? null,
      total: assessment?.weightedTotal ?? null,
      basisLabel: assessment ? WEIGHT_BASIS_LABEL[assessment.weightBasis] : "Not assessed",
      ratings: (assessment?.criterionResults ?? []).map((r) => ({ name: r.name, rating: r.rating, weight: r.weight })),
      heur: Object.fromEntries(Object.entries(assessment?.heuristics ?? {}).map(([k, v]) => [k, { rating: v.rating, rationale: v.rationale }])),
      overlap: mine[0] ? { level: mine[0].similarity!.level, name: mine[0].name } : reviewed.length ? { level: "different" as const, name: `none of ${reviewed.length} reviewed` } : null,
      evidence: (assessment?.criterionResults ?? []).reduce((s, r) => s + r.evidence.filter((e) => e.kind === "debate_claim").length, 0),
      gaps: (assessment?.criterionResults ?? []).flatMap((r) => r.gaps).slice(0, 4),
      feasibility: idea.feasibility ? { complexity: idea.feasibility.complexity.rating, demoReliability: idea.feasibility.demoReliability.rating, low: idea.feasibility.estimateHours.low, high: idea.feasibility.estimateHours.high } : null,
    };
  });
  return (
    <div>
      <PageHeader eyebrow="Ideas" title="Idea Comparison Arena" description={`Compare two to five ideas${active && scoped.length >= 2 ? ` for ${active.name}` : ""}: where each is better supported, what's still uncertain, and which is lower risk.`} />
      <CompareArena ideas={ideas} />
    </div>
  );
}
