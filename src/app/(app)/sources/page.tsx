import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Library } from "lucide-react";
import { SourceActions } from "@/components/hackathon/research-actions";
import { CachedBadge } from "@/components/research/badges";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { sourceSummaryColumns } from "@/lib/db/columns";
import { hackathons, projectIdeas, researchSources } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { authorityLabel } from "@/lib/research/verify";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Research Sources" };

const FILTERS = [
  ["all", "All"],
  ["official", "Official"],
  ["projects", "Projects & competitors"],
  ["user", "Provided by you"],
  ["problems", "Failed / outdated"],
] as const;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "all" } = await searchParams;
  const { workspaceId } = await pageContext();
  const db = await getDb();
  const [rows, hacks, ideas] = await Promise.all([
    db.select(sourceSummaryColumns).from(researchSources).where(eq(researchSources.workspaceId, workspaceId)).orderBy(desc(researchSources.createdAt)).limit(300),
    db.select({ id: hackathons.id, name: hackathons.name }).from(hackathons).where(eq(hackathons.workspaceId, workspaceId)),
    db.select({ id: projectIdeas.id, name: projectIdeas.name }).from(projectIdeas).where(eq(projectIdeas.workspaceId, workspaceId)),
  ]);
  const filtered = rows.filter((r) => {
    if (f === "official") return r.sourceType.startsWith("official") || r.sourceType === "organizer_blog";
    if (f === "projects") return ["devpost_project", "github_repo", "hn_discussion", "product_site", "web_result", "secondary_coverage"].includes(r.sourceType);
    if (f === "user") return r.sourceType === "user_pasted" || r.sourceType === "user_pdf";
    if (f === "problems") return r.status !== "retrieved";
    return true;
  });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Research" title="Research Sources" description="Every page, document and repository RubricRoom retrieved, with when it was retrieved and how much authority it carries. External content is always treated as data, never as instructions." />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={`/sources?f=${k}`} className={`rounded-full border px-3 py-1 text-sm ${f === k ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:bg-muted"}`}>
            {l}
          </Link>
        ))}
        <span className="ml-auto self-center text-sm text-muted-foreground">
          {filtered.length} of {rows.length} sources
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<Library />} title="No sources here" description="Sources appear when you analyze a hackathon or research an idea." />
      ) : (
        <Card>
          <CardContent className="pt-2">
            <ul className="divide-y" data-testid="all-sources">
              {filtered.map((s) => {
                const owner = s.hackathonId ? hacks.find((h) => h.id === s.hackathonId) : s.ideaId ? ideas.find((i) => i.id === s.ideaId) : null;
                return (
                  <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.title ?? s.url}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.finalUrl ?? s.url}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="outline">{s.sourceType.replace(/_/g, " ")}</Badge>
                        <Badge tone="default">
                          A{s.authority} · {authorityLabel(s.authority)}
                        </Badge>
                        {owner && (
                          <Link href={s.hackathonId ? `/hackathons/${s.hackathonId}?tab=sources` : `/ideas/${s.ideaId}?tab=originality`} className="text-xs text-primary hover:underline">
                            {owner.name}
                          </Link>
                        )}
                        {s.cached && <CachedBadge at={s.retrievedAt} />}
                        {s.status !== "retrieved" && <Badge tone={s.status === "failed" || s.status === "blocked" ? "coral" : "amber"}>{s.status}</Badge>}
                      </div>
                      {s.error && <p className="mt-1 text-xs text-coral">{s.error}</p>}
                      {s.userReportedIssue && <p className="mt-1 text-xs text-amber-foreground">{s.userReportedIssue}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.retrievedAt ? `Retrieved ${formatDateTime(s.retrievedAt)}` : "Not retrieved"}
                        {s.httpStatus ? ` · HTTP ${s.httpStatus}` : ""}
                        {s.contentHash ? ` · sha256 ${s.contentHash.slice(0, 10)}…` : ""}
                      </p>
                    </div>
                    <SourceActions sourceId={s.id} url={s.finalUrl ?? s.url} status={s.status} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
