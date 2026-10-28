import { desc, eq } from "drizzle-orm";
import { ExternalLink, Flame, Layers, MessageSquareQuote, Radar, Trophy, Users } from "lucide-react";
import { OpportunityCardView, RadarControls } from "@/components/radar/radar-controls";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { isAIConfigured } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { opportunitySets, projectIdeas } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { listHackathons } from "@/lib/services/hackathons";
import { relativeTime, truncateText } from "@/lib/format";

export const metadata = { title: "Opportunity Radar" };

const SIGNAL_META: Record<string, { label: string; icon: typeof Radar; tone: "teal" | "amber" | "primary" | "gray" | "coral" }> = {
  pain_point: { label: "Public pain point", icon: MessageSquareQuote, tone: "teal" },
  crowded: { label: "Crowding measure", icon: Flame, tone: "coral" },
  official: { label: "Official", icon: Trophy, tone: "primary" },
  sponsor: { label: "Sponsor", icon: Layers, tone: "amber" },
  competitor: { label: "Known project", icon: Users, tone: "gray" },
};

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ job?: string; hackathon?: string; base?: string }> }) {
  const sp = await searchParams;
  const { workspaceId, active } = await pageContext();
  const db = await getDb();
  const [hackathons, sets, ideas] = await Promise.all([
    listHackathons(workspaceId),
    db.select().from(opportunitySets).where(eq(opportunitySets.workspaceId, workspaceId)).orderBy(desc(opportunitySets.createdAt)).limit(4),
    db.select({ id: projectIdeas.id, name: projectIdeas.name }).from(projectIdeas).where(eq(projectIdeas.workspaceId, workspaceId)),
  ]);
  const latest = sets[0];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Opportunity Radar" title="Invent a better direction" description="Nova goes beyond direct competitors to look for neglected problems, underserved users and fresh combinations, grounded in real public signals. Every idea is checked against known concepts so you don't get the same project under a new name." />
      <Card>
        <CardContent className="pt-5">
          <RadarControls hackathons={hackathons.map((h) => ({ id: h.id, name: h.name }))} ideas={ideas} defaultHackathonId={sp.hackathon ?? active?.id ?? null} defaultBaseId={sp.base ?? null} jobId={sp.job ?? null} aiConfigured={isAIConfigured()} />
        </CardContent>
      </Card>

      {latest ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Latest run</span>
            <Badge tone="outline" className="capitalize">
              {latest.mode.replace("_", " ")}
            </Badge>
            {latest.modifiers.map((m) => (
              <Badge key={m} tone="primary">
                {m.replace("_", " ")}
              </Badge>
            ))}
            <span>{relativeTime(latest.createdAt)}</span>
          </div>
          {latest.cards.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {latest.cards.map((c, i) => (
                <OpportunityCardView key={`${latest.id}-${i}`} card={c} setId={latest.id} index={i} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Radar />} title="No concepts generated in this run" description={latest.method === "signals_only" ? "No AI provider is configured, so only research signals were gathered (below)." : "Generation failed or every proposal duplicated a known concept. Try different modifiers."} />
          )}
          {latest.diversityNotes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Diversity check</CardTitle>
                <CardDescription>Concepts with the same problem, audience and workflow under a new name were removed.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {latest.diversityNotes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Signals behind this run</CardTitle>
              <CardDescription>Everything Nova was allowed to cite. Problems are labelled “observed” only when one of these supports them.</CardDescription>
            </CardHeader>
            <CardContent>
              {latest.signals.length ? (
                <ul className="divide-y" data-testid="signals">
                  {latest.signals.map((s, i) => {
                    const m = SIGNAL_META[s.kind] ?? SIGNAL_META.competitor;
                    return (
                      <li key={i} className="flex items-start gap-3 py-2.5">
                        <m.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge tone={m.tone}>{m.label}</Badge>
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                                {s.label} <ExternalLink className="inline size-3" />
                              </a>
                            ) : (
                              <span>{s.label}</span>
                            )}
                          </div>
                          {s.detail && s.kind !== "pain_point" && <p className="mt-0.5 text-xs text-muted-foreground">{truncateText(s.detail, 220)}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No signals were retrieved.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState icon={<Radar />} title="No exploration yet" description="Pick a discovery mode and run it. Nova's signals come from Hacker News, GitHub and the organizer's own pages (plus web search if a provider is configured)." />
      )}
    </div>
  );
}
