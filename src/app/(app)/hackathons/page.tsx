import Link from "next/link";
import { Compass } from "lucide-react";
import { AnalyzeForm, DemoButton } from "@/components/hackathon/start-actions";
import { Countdown } from "@/components/shell/countdown";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui/primitives";
import { pageContext } from "@/lib/page-context";
import { formatDeadline } from "@/lib/deadline";
import { listHackathons, upcomingFirst } from "@/lib/services/hackathons";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Explore Hackathons" };

const STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "primary" }> = {
  complete: { label: "Research complete", tone: "teal" },
  partial: { label: "Partially researched", tone: "amber" },
  failed: { label: "Research failed", tone: "coral" },
  pending: { label: "Researching…", tone: "primary" },
};

export default async function HackathonsPage() {
  const { workspaceId, active } = await pageContext();
  const list = upcomingFirst(await listHackathons(workspaceId));
  return (
    <div>
      <PageHeader eyebrow="Explore" title="Hackathons" description="Analyze any public hackathon page. RubricRoom fetches the official pages, extracts the rules and rubric, and cites a source for every claim." />
      <Card className="mb-8">
        <CardContent className="pt-5">
          <AnalyzeForm />
        </CardContent>
      </Card>
      {list.length === 0 ? (
        <EmptyState icon={<Compass />} title="No hackathons yet" description="Paste a URL above, or open the cached WeMakeDevs × Wispr Flow demo." action={<DemoButton size="default" variant="default" />} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((h) => {
            const s = STATUS[h.sourceStatus] ?? STATUS.pending;
            return (
              <Link key={h.id} href={`/hackathons/${h.id}`} className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/40" data-testid="hackathon-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{h.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{h.organizer ?? h.officialUrl ?? "Pasted rules"}</div>
                  </div>
                  {active?.id === h.id && <Badge tone="teal">Active</Badge>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {h.deadlineAt ? <Countdown deadline={h.deadlineAt.toISOString()} compact /> : <Badge tone="gray">Deadline not verified</Badge>}
                  {h.deadlineAt && <span className="text-xs text-muted-foreground">{formatDeadline(h)}</span>}
                  <Badge tone={s.tone}>{s.label}</Badge>
                  {h.origin === "cached_seed" && <Badge tone="gray">Cached demo</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">updated {relativeTime(h.updatedAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
