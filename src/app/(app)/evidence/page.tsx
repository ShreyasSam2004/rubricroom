import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { CircleCheck, CircleDashed, ClipboardCheck, Info, Plus } from "lucide-react";
import { AddEvidence, EvidenceItem } from "@/components/evidence/evidence-ui";
import { EvidenceBadge } from "@/components/research/badges";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Progress } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { projectIdeas } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { evidenceBoard } from "@/lib/services/evidence";
import { formatDeadline } from "@/lib/deadline";

export const metadata = { title: "Evidence Board" };

export default async function EvidencePage() {
  const { workspaceId, active, ws } = await pageContext();
  if (!active) {
    return (
      <div>
        <PageHeader eyebrow="Execution" title="Evidence-to-Rubric Board" />
        <EmptyState icon={<ClipboardCheck />} title="No active hackathon" description="Analyze a hackathon or open the live demo first." action={<Button asChild size="sm"><Link href="/hackathons">Explore hackathons</Link></Button>} />
      </div>
    );
  }
  const db = await getDb();
  const ideas = await db.select().from(projectIdeas).where(eq(projectIdeas.workspaceId, workspaceId)).orderBy(desc(projectIdeas.updatedAt));
  const idea = ideas.find((i) => i.status === "selected" && i.hackathonId === active.id) ?? ideas.find((i) => i.id === ws.activeIdeaId) ?? null;
  const board = await evidenceBoard(workspaceId, active.id, idea?.id ?? null);
  if (!board) return null;
  const r = board.readiness;
  const deadline = active.deadlineAt;
  const allItems = [...board.rows.flatMap((x) => x.items), ...board.deliverables];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Execution"
        title="Evidence-to-Rubric Board"
        description={`Every official criterion for ${active.name}, linked to the proof judges can actually see${idea ? ` for “${idea.name}”` : ""}.`}
      />
      {!idea && (
        <Callout tone="warning" icon={<Info />} title="No project selected">
          Evidence is tracked per hackathon. <Link href="/compare">Select your project</Link> to attach it to a specific idea.
        </Callout>
      )}

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm text-muted-foreground">Submission readiness</div>
              <div className="text-2xl font-semibold" data-testid="readiness">
                {r.required ? `${r.prepared} of ${r.required} required artifacts prepared` : "Required deliverables not verified"}
              </div>
              {deadline && <div className="text-xs text-muted-foreground">Due {formatDeadline(active)} · source: official submission requirements</div>}
            </div>
          </div>
          {r.required > 0 && <Progress value={(r.prepared / r.required) * 100} tone="teal" />}
          <ul className="grid gap-2 md:grid-cols-2" data-testid="deliverables">
            {r.items.map((it) => (
              <li key={it.key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 gap-2">
                  {it.prepared ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-teal" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <div className="text-sm">{it.label}</div>
                    {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
                    <div className="mt-1">
                      <EvidenceBadge status={it.status} />
                    </div>
                  </div>
                </div>
                <AddEvidence
                  hackathonId={active.id}
                  ideaId={idea?.id ?? null}
                  deliverableKey={it.key}
                  preset={{ title: it.label, artifactType: it.key === "demo_video" ? "video" : it.key === "usage_evidence" ? "usage_card" : it.key === "description" ? "note" : it.key === "repository" ? "repo" : "url" }}
                  trigger={
                    <Button size="xs" variant={it.prepared ? "ghost" : "secondary"} data-testid={`add-deliverable-${it.key}`}>
                      <Plus /> {it.prepared ? "Add" : "Attach"}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
          {board.deliverables.length > 0 && (
            <ul className="grid gap-2 md:grid-cols-2">
              {board.deliverables.map((d) => (
                <EvidenceItem key={d.id} item={d} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {board.rows.map(({ criterion, suggestions, items }) => (
          <Card key={criterion.id} data-testid="criterion-evidence">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>{criterion.name}</CardTitle>
                <CardDescription>
                  {criterion.weight !== null ? `${criterion.weight}% of the official score` : "Weight not published"}
                  {criterion.description ? ` · ${criterion.description}` : ""}
                </CardDescription>
              </div>
              <AddEvidence hackathonId={active.id} ideaId={idea?.id ?? null} criterionId={criterion.id} />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Evidence that would convince a judge</div>
                <ul className="space-y-1.5">
                  {suggestions.map((s) => {
                    const has = items.some((i) => i.title.toLowerCase() === s.title.toLowerCase());
                    return (
                      <li key={s.title} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          {has ? <CircleCheck className="size-4 text-teal" /> : <CircleDashed className="size-4 text-muted-foreground" />}
                          {s.title}
                        </span>
                        {!has && (
                          <AddEvidence
                            hackathonId={active.id}
                            ideaId={idea?.id ?? null}
                            criterionId={criterion.id}
                            preset={s}
                            trigger={
                              <button type="button" className="text-xs text-primary hover:underline">
                                Attach
                              </button>
                            }
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Attached ({items.length})</div>
                {items.length ? (
                  <ul className="space-y-2">
                    {items.map((i) => (
                      <EvidenceItem key={i.id} item={i} />
                    ))}
                  </ul>
                ) : (
                  <Badge tone="coral">Missing</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {allItems.filter((i) => i.status === "auto_verified").length} item(s) reachability-verified automatically. Reachability only shows a link opens; it doesn&apos;t prove the app works. Screenshots and usage cards always need a human check.
      </p>
    </div>
  );
}
