import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Gavel } from "lucide-react";
import { JudgeSetup } from "@/components/judge/setup-form";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { debateSessions, judgingCriteria, projectIdeas } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { listHackathons } from "@/lib/services/hackathons";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Judge's Room" };

export default async function JudgePage({ searchParams }: { searchParams: Promise<{ hackathon?: string; idea?: string }> }) {
  const sp = await searchParams;
  const { workspaceId, active, ws } = await pageContext();
  const db = await getDb();
  const [ideas, hackathons, sessions] = await Promise.all([
    db.select().from(projectIdeas).where(eq(projectIdeas.workspaceId, workspaceId)).orderBy(desc(projectIdeas.updatedAt)),
    listHackathons(workspaceId),
    db.select().from(debateSessions).where(eq(debateSessions.workspaceId, workspaceId)).orderBy(desc(debateSessions.updatedAt)).limit(8),
  ]);
  const criteria = hackathons.length ? await db.select().from(judgingCriteria).where(inArray(judgingCriteria.hackathonId, hackathons.map((h) => h.id))) : [];
  const live = ideas.filter((i) => i.status !== "archived");
  const preferred = sp.idea ?? ws.activeIdeaId ?? live.find((i) => i.hackathonId === (sp.hackathon ?? active?.id))?.id ?? null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Judge's Room"
        title="Defend your idea before the judges do"
        description="A panel of simulated evaluation roles challenges your idea against the hackathon's real rubric. Answer by voice. The assessment changes only when you bring new evidence. Disagreeing alone won't move it."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-5">
            <JudgeSetup
              ideas={live.map((i) => ({ id: i.id, name: i.name, hackathonId: i.hackathonId }))}
              hackathons={hackathons.map((h) => ({ id: h.id, name: h.name, tracks: (h.dossier?.tracks ?? []).map((t) => t.name) }))}
              criteria={criteria.map((c) => ({ id: c.id, name: c.name, hackathonId: c.hackathonId }))}
              defaultIdeaId={preferred}
              defaultHackathonId={sp.hackathon ?? active?.id ?? null}
            />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent sessions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessions.length ? (
                sessions.map((s) => (
                  <Link key={s.id} href={`/judge/${s.id}`} className="flex items-center justify-between rounded-lg border p-2.5 text-sm hover:border-primary/40">
                    <span className="flex items-center gap-2">
                      <Gavel className="size-3.5 text-muted-foreground" />
                      {ideas.find((i) => i.id === s.ideaId)?.name ?? "Idea"}
                    </span>
                    <span className="text-xs text-muted-foreground">{relativeTime(s.updatedAt)}</span>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No sessions yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 pt-5 text-xs leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">The panel</strong>: The User Advocate (&ldquo;Does someone genuinely need this?&rdquo;), The Originality Skeptic, The Engineering Judge, The Sponsor Judge and The Demo Judge.
              </p>
              <p>These are simulated perspectives, not the real judges. RubricRoom doesn&apos;t know any real judge&apos;s private preferences and never predicts a win.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
