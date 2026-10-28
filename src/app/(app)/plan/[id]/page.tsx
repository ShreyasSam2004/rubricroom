import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleAlert, Info, Layers, ShieldAlert } from "lucide-react";
import { DemoStrategy, PlanBoard } from "@/components/plan/plan-board";
import { Countdown } from "@/components/shell/countdown";
import { Badge, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { pageContext } from "@/lib/page-context";
import { rubricContext } from "@/lib/services/ideas";
import { getPlanBundle } from "@/lib/services/plans";
import { formatDeadline } from "@/lib/deadline";

export const metadata = { title: "Build plan" };

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ task?: string; status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspaceId } = await pageContext();
  const b = await getPlanBundle(workspaceId, id);
  if (!b) notFound();
  const { plan, tasks, idea, demo } = b;
  const { hackathon } = await rubricContext(workspaceId, idea?.hackathonId ?? null);
  const videoReq = hackathon?.dossier?.submission.find((s) => s.key === "demo_video");
  const m = videoReq?.detail?.match(/(\d+|one|two|three|four|five)\s*min/i);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const defaultLimit = m ? (Number(m[1]) || words[m[1].toLowerCase()]) * 60 : 120;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/plan" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All plans
        </Link>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-primary">Build Strategy</div>
            <h1 className="text-2xl font-semibold tracking-tight">{idea?.name ?? "Plan"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.days.length} day(s) · ~{plan.totalHours}h of focused work ({plan.hoursPerDay}h/day) · deadline {plan.deadlineAt ? formatDeadline({ deadlineAt: plan.deadlineAt, deadlineText: hackathon?.deadlineText, deadlineHasTime: hackathon?.deadlineHasTime, timezone: hackathon?.timezone }) : "not verified"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {plan.postDeadline && <Badge tone="amber">Post-deadline roadmap</Badge>}
            <Badge tone={plan.method === "ai" ? "primary" : "gray"}>{plan.method === "ai" ? "Sprint (AI) on a code-computed calendar" : "Rule-based plan"}</Badge>
            {plan.deadlineAt && <Countdown deadline={plan.deadlineAt.toISOString()} compact />}
          </div>
        </div>
      </div>

      {plan.postDeadline && (
        <Callout tone="warning" icon={<CircleAlert />} title="The submission deadline has passed">
          This is a post-deadline roadmap, not a hackathon plan.
        </Callout>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plan.tiers.map((t) => (
          <Card key={t.tier}>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <Layers className="size-3.5" /> {t.tier === "core" ? "Must ship" : t.tier === "strong" ? "Makes the demo stronger" : "Only if the core works"}
              </CardDescription>
              <CardTitle>{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-0.5 text-sm">{t.features.length ? t.features.map((f) => <li key={f}>{f}</li>) : <li className="list-none text-muted-foreground">—</li>}</ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <PlanBoard
        planId={plan.id}
        ideaId={plan.ideaId}
        days={plan.days}
        tasks={tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, day: t.day, tier: t.tier, priority: t.priority, status: t.status, acceptance: t.acceptance, notes: t.notes, proofUrl: t.proofUrl, estimateHours: t.estimateHours, dependsOn: t.dependsOn }))}
        pendingTask={sp.task ? { query: sp.task, status: sp.status ?? "done" } : null}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Architecture</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {Object.entries(plan.architecture).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                  <dt className="capitalize text-muted-foreground">{k}</dt>
                  <dd>{Array.isArray(v) ? v.join(", ") || "—" : v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-coral" /> Risk register
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5" data-testid="risks">
              {plan.risks.map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={r.likelihood === "high" ? "coral" : r.likelihood === "medium" ? "amber" : "gray"}>{r.likelihood}</Badge>
                    <span className="font-medium capitalize">{r.category}</span>
                  </div>
                  <p className="mt-0.5">{r.description}</p>
                  <p className="text-xs text-muted-foreground">→ {r.mitigation}</p>
                  {r.scopeReduction && <p className="text-xs text-coral">Suggested cut: {r.scopeReduction}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {plan.assumptions.length > 0 && (
        <Callout tone="neutral" icon={<Info />} title="Assumptions">
          <ul className="mt-1 space-y-0.5">
            {plan.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </Callout>
      )}

      <DemoStrategy ideaId={plan.ideaId} demo={demo ? { hook: demo.hook, segments: demo.segments, closing: demo.closing, checklist: demo.checklist, excludedFeatures: demo.excludedFeatures, refinements: demo.refinements, method: demo.method, timeLimitSec: demo.timeLimitSec } : null} defaultLimit={defaultLimit} />
    </div>
  );
}
