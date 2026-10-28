import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Route } from "lucide-react";
import { CreatePlanForm } from "@/components/plan/create-plan";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { buildPlans, projectIdeas } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { getProfile } from "@/lib/services/profile";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Build Strategy" };

export default async function PlanIndex({ searchParams }: { searchParams: Promise<{ create?: string; days?: string; task?: string; status?: string }> }) {
  const sp = await searchParams;
  const { workspaceId, ws } = await pageContext();
  const db = await getDb();
  const [ideas, plans, profile] = await Promise.all([
    db.select().from(projectIdeas).where(eq(projectIdeas.workspaceId, workspaceId)).orderBy(desc(projectIdeas.updatedAt)),
    db.select().from(buildPlans).where(eq(buildPlans.workspaceId, workspaceId)).orderBy(desc(buildPlans.createdAt)),
    getProfile(workspaceId),
  ]);
  const live = ideas.filter((i) => i.status !== "archived");
  const focus = live.find((i) => i.status === "selected") ?? live.find((i) => i.id === ws.activeIdeaId) ?? live[0];
  const focusPlan = focus ? plans.find((p) => p.ideaId === focus.id) : undefined;

  // Voice: "mark the deploy task as done" → open the plan with a confirmation card. Otherwise this
  // page always shows the New plan form, so another idea can be planned even when one plan exists.
  if (sp.task && focusPlan) redirect(`/plan/${focusPlan.id}?task=${encodeURIComponent(sp.task)}&status=${sp.status ?? "done"}`);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Execution" title="Build Strategy" description="Sprint turns your selected idea into a plan that fits the real deadline and your hours: Core MVP first, then the strong-demo features, with the submission deliverables on the last day." />
      {live.length ? (
        <Card>
          <CardHeader>
            <CardTitle>New plan</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePlanForm ideas={live.map((i) => ({ id: i.id, name: i.name, selected: i.status === "selected" }))} defaultIdeaId={focus?.id ?? null} defaultHours={profile.data.hoursPerDay} defaultDays={sp.days ? Number(sp.days) : null} />
            <p className="mt-3 text-sm text-muted-foreground">
              Planning a new idea? <Link href="/ideas">Pitch it in My Ideas</Link> first, by voice or text, and it appears in this list.
            </p>
          </CardContent>
        </Card>
      ) : (
        <EmptyState icon={<Route />} title="No ideas to plan yet" description="Pitch an idea in My Ideas first, by voice or text; then Sprint can plan it." action={<Link href="/ideas">Go to My Ideas</Link>} />
      )}
      {plans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Existing plans</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {plans.map((p) => (
                <li key={p.id}>
                  <Link href={`/plan/${p.id}`} className="flex items-center justify-between py-2.5 text-sm hover:text-primary">
                    <span>
                      {ideas.find((i) => i.id === p.ideaId)?.name ?? "Idea"} · {p.days.length} day(s)
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {p.postDeadline && <Badge tone="amber">Post-deadline roadmap</Badge>}
                      {relativeTime(p.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
