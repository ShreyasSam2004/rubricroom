import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { BadgeCheck, Info, Lightbulb } from "lucide-react";
import { OverlapBadge } from "@/components/research/badges";
import { NewIdeaForm } from "@/components/ideas/new-idea";
import { RatingDots } from "@/components/ideas/rubric-panel";
import { Badge, Callout, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { assessmentRevisions, existingProjects } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { listHackathons } from "@/lib/services/hackathons";
import { listIdeas } from "@/lib/services/ideas";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "My Ideas" };

const ORIGIN: Record<string, string> = { sample: "Sample idea", nova: "From Opportunity Radar", user: "Your idea" };

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ top?: string; explain?: string; change?: string }> }) {
  const { workspaceId, active, ws } = await pageContext();
  const sp = await searchParams;
  const [ideas, hackathons] = await Promise.all([listIdeas(workspaceId), listHackathons(workspaceId)]);
  const live = ideas.filter((i) => i.idea.status !== "archived");
  const focus = live.find((i) => i.idea.id === ws.activeIdeaId) ?? live.find((i) => i.idea.status === "selected") ?? live[0];

  // Voice commands route here: "Remove X from the MVP" → open the idea with the change prefilled.
  if (sp.change && focus) redirect(`/ideas/${focus.idea.id}?change=${encodeURIComponent(sp.change)}`);
  if (sp.explain && focus) redirect(`/ideas/${focus.idea.id}?tab=assessment`);

  const top = sp.top ? Math.max(1, Math.min(10, Number(sp.top) || 3)) : null;
  const ranked = top ? [...live].sort((a, b) => (b.assessment?.weightedTotal ?? -1) - (a.assessment?.weightedTotal ?? -1)).slice(0, top) : live;
  const db = await getDb();
  const projects = await db.select({ ideaId: existingProjects.ideaId, similarity: existingProjects.similarity }).from(existingProjects).where(eq(existingProjects.workspaceId, workspaceId));
  const order = ["different", "adjacent", "moderate", "strong"] as const;
  const strongest = (id: string) =>
    projects.filter((p) => p.ideaId === id && p.similarity).reduce<(typeof order)[number] | null>((acc, p) => (!acc || order.indexOf(p.similarity!.level) > order.indexOf(acc) ? p.similarity!.level : acc), null);
  const revisions = await db.select().from(assessmentRevisions).where(and(eq(assessmentRevisions.workspaceId, workspaceId))).orderBy(desc(assessmentRevisions.createdAt)).limit(1);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ideas" title={top ? `Your top ${top} ideas` : "My Ideas"} description="Every idea keeps immutable versions, an assessment against the real rubric, and an audit trail of what changed and why." />
      {top && (
        <Callout tone="info" icon={<Info />} title="Ranked by weighted planning estimate">
          This is an AI-assisted estimate, not a prediction. <Link href="/ideas">Show all ideas</Link> · <Link href="/compare">Compare side by side</Link>
        </Callout>
      )}
      {revisions[0] && !top && (
        <Callout tone="neutral" icon={<Info />} title="Latest assessment change">
          {revisions[0].reason} <span className="text-xs">({relativeTime(revisions[0].createdAt)})</span>
        </Callout>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          {ranked.length === 0 ? (
            <EmptyState icon={<Lightbulb />} title="No ideas yet" description="Pitch one by voice on the right, or open the live demo from the Dashboard." />
          ) : (
            ranked.map(({ idea, version, assessment }, i) => {
              const overlap = strongest(idea.id);
              return (
                <Link key={idea.id} href={`/ideas/${idea.id}`} className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40" data-testid="idea-row">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {top && <span className="text-sm font-semibold text-muted-foreground">#{i + 1}</span>}
                        <span className="font-semibold">{idea.name}</span>
                        {idea.status === "selected" && (
                          <Badge tone="teal">
                            <BadgeCheck /> Selected project
                          </Badge>
                        )}
                        <Badge tone="gray">{ORIGIN[idea.origin] ?? idea.origin}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{version?.summary}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xl font-semibold tabular-nums">{assessment?.weightedTotal ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">estimate / 100</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {assessment?.criterionResults.slice(0, 5).map((r) => (
                      <span key={r.criterionId} className="inline-flex items-center gap-1.5" title={r.name}>
                        <span className="max-w-28 truncate">{r.name}</span> <RatingDots rating={r.rating} size="sm" />
                      </span>
                    ))}
                    {overlap ? <OverlapBadge level={overlap} /> : <Badge tone="outline">Competitors not researched</Badge>}
                    <span className="ml-auto">v{version?.version} · {relativeTime(idea.updatedAt)}</span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Pitch a new idea</CardTitle>
          </CardHeader>
          <CardContent>
            <NewIdeaForm hackathons={hackathons.map((h) => ({ id: h.id, name: h.name }))} defaultHackathonId={active?.id ?? null} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
