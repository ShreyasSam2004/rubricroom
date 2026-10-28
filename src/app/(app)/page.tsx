import Link from "next/link";
import { ArrowRight, BadgeCheck, ClipboardCheck, Compass, Gavel, Lightbulb, Radar, Route, ScrollText, Sparkles } from "lucide-react";
import { ExampleRuns } from "@/components/examples/example-runs";
import { AnalyzeForm, DemoButton } from "@/components/hackathon/start-actions";
import { Countdown } from "@/components/shell/countdown";
import { TourButton, TourPlayer } from "@/components/tour/product-tour";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { pageContext } from "@/lib/page-context";
import { dashboardData } from "@/lib/services/dashboard";
import { EXAMPLE_DISCLOSURE, listExamples } from "@/lib/services/examples";
import { isShowcaseHackathon, SHOWCASE_META } from "@/lib/services/showcase";
import { formatDate, relativeTime } from "@/lib/utils";

const AGENTS = [
  { name: "Atlas", role: "Event analyst", desc: "Reads the official pages and extracts rules and the rubric, with a citation for every claim." },
  { name: "Scout", role: "Competition researcher", desc: "Searches GitHub, Hacker News and Devpost, then compares concept structure rather than titles." },
  { name: "Nova", role: "Opportunity explorer", desc: "Finds less crowded directions, grounded in real public signals." },
  { name: "Verdict", role: "Judge simulator", desc: "Challenges your idea against the real rubric. Scores move only when you add evidence." },
  { name: "Forge", role: "Feasibility", desc: "Flags scope and integration risk and proposes an MVP." },
  { name: "Prism", role: "Strategist", desc: "Structures your spoken pitch and compares ideas." },
  { name: "Sprint", role: "Build planner", desc: "Makes a plan that fits the real deadline, plus an honest demo script." },
  { name: "Proof", role: "Evidence auditor", desc: "Maps each judging criterion to submission proof and checks it." },
];

export default async function Dashboard() {
  const { workspaceId, active } = await pageContext();
  const d = await dashboardData(workspaceId, active?.id ?? null);
  const hasData = d.hackathons.length > 0;
  // Until the visitor brings their own hackathon, the tour stays up and the sample is labelled.
  const ownWork = d.hackathons.some((h) => h.origin !== "cached_seed");
  const sample = SHOWCASE_META && d.active && isShowcaseHackathon(d.active) ? d.active : null;
  const examples = listExamples().map((e) => ({ ...e, captured: formatDate(e.capturedAt, "Asia/Kolkata") }));

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-5 py-8 md:px-10 md:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary-soft blur-3xl" aria-hidden />
        <div className="relative max-w-3xl">
          <Badge tone="primary" className="mb-4">
            <Sparkles /> Challenge your idea before the judges do
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">Find the idea worth building.</h1>
          <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground md:text-lg">Understand the hackathon, investigate what&apos;s already out there, and challenge your idea before you commit.</p>
          <div className="mt-6 space-y-3">
            <AnalyzeForm />
            <div className="flex flex-wrap items-center gap-3">
              <DemoButton label="Try RubricRoom with a Real Hackathon" size="default" />
              <TourButton />
            </div>
            <p className="text-sm text-muted-foreground">The live demo opens the WeMakeDevs × Wispr Flow challenge from a cached copy of the official pages. No login.</p>
          </div>
        </div>
      </section>

      {sample && SHOWCASE_META && (
        <Callout tone="neutral" title={`You're in a sample workspace · captured ${formatDate(SHOWCASE_META.capturedAt, "Asia/Kolkata")} with ${SHOWCASE_META.model}`}>
          <div data-testid="sample-workspace">
            <p>
              It shows RubricRoom working on the WeMakeDevs × Wispr Flow challenge: three sample ideas, two Judge&apos;s Room sessions, a build plan, an evidence note and Opportunity Radar results. Paste your own hackathon link above to start on yours; this sample stays separate.
            </p>
            <p className="mt-1.5">{SHOWCASE_META.disclosure}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {[
                { href: `/hackathons/${sample.id}`, label: "Event dossier", icon: ScrollText },
                { href: "/compare", label: "Idea comparison", icon: Lightbulb },
                { href: "/judge", label: "Judge's Room sessions", icon: Gavel },
                { href: d.plan ? `/plan/${d.plan.id}` : "/plan", label: "Build plan", icon: Route },
                { href: "/evidence", label: "Evidence Board", icon: ClipboardCheck },
                { href: "/radar", label: "Opportunity Radar", icon: Radar },
              ].map((l) => (
                <Link key={l.href} href={l.href} className="inline-flex items-center gap-1.5 !no-underline hover:!underline">
                  <l.icon className="size-3.5" /> {l.label}
                </Link>
              ))}
            </div>
          </div>
        </Callout>
      )}

      {!ownWork && (
        <section className="space-y-3" data-testid="tour-section">
          <div>
            <h2 className="text-lg font-semibold">New here? See how RubricRoom works in 2 minutes</h2>
            <p className="text-sm text-muted-foreground">A walkthrough of every feature in the real app, from pasting a hackathon link to a build plan. Click a chapter to jump to it.</p>
          </div>
          <TourPlayer />
        </section>
      )}

      <ExampleRuns examples={examples} disclosure={EXAMPLE_DISCLOSURE} />

      {hasData ? (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardDescription>Active hackathon</CardDescription>
                <CardTitle className="text-xl">{d.active?.name ?? "None selected"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {d.active ? (
                  <>
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      {d.active.deadlineAt ? <Countdown deadline={d.active.deadlineAt.toISOString()} /> : <span className="text-sm text-muted-foreground">Deadline not verified</span>}
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/hackathons/${d.active.id}`}>
                          Open intelligence <ArrowRight />
                        </Link>
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Link href={d.selected ? `/ideas/${d.selected.id}` : "/compare"} className="rounded-lg border p-3 hover:border-primary/40">
                        <div className="text-xs text-muted-foreground">Active project</div>
                        <div className="mt-1 truncate text-sm font-medium">{d.selected?.name ?? "Not decided yet"}</div>
                      </Link>
                      <Link href={d.plan ? `/plan/${d.plan.id}` : "/plan"} className="rounded-lg border p-3 hover:border-primary/40">
                        <div className="text-xs text-muted-foreground">Build plan</div>
                        {d.plan ? (
                          <>
                            <div className="mt-1 text-sm font-medium">
                              {d.plan.done} of {d.plan.total} core tasks
                            </div>
                            <Progress value={(d.plan.done / Math.max(1, d.plan.total)) * 100} className="mt-2 h-1.5" tone="teal" />
                          </>
                        ) : (
                          <div className="mt-1 text-sm font-medium">No plan yet</div>
                        )}
                      </Link>
                      <Link href="/evidence" className="rounded-lg border p-3 hover:border-primary/40">
                        <div className="text-xs text-muted-foreground">Submission readiness</div>
                        {d.readiness && d.readiness.required > 0 ? (
                          <>
                            <div className="mt-1 text-sm font-medium">
                              {d.readiness.prepared} of {d.readiness.required} required artifacts
                            </div>
                            <Progress value={(d.readiness.prepared / d.readiness.required) * 100} className="mt-2 h-1.5" tone="amber" />
                          </>
                        ) : (
                          <div className="mt-1 text-sm font-medium">Requirements not verified</div>
                        )}
                      </Link>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Pick a hackathon from Explore Hackathons.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Pending decisions</CardDescription>
                <CardTitle>What needs you</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {d.runningJobs.length > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-primary-soft/60 p-2.5">
                    <span>{d.runningJobs.length} research run(s) in progress</span>
                    <Badge tone="primary">Running</Badge>
                  </div>
                )}
                {d.pendingUpdates.map((u) => (
                  <Link key={u.id} href={`/judge/${u.sessionId}`} className="block rounded-lg border p-2.5 hover:border-primary/40">
                    Confirm an idea correction from the Judge&apos;s Room
                  </Link>
                ))}
                {!d.selected && d.ideas.length > 1 && (
                  <Link href="/compare" className="block rounded-lg border p-2.5 hover:border-primary/40">
                    Compare {d.ideas.length} ideas and choose your project
                  </Link>
                )}
                {d.readiness && d.readiness.required > d.readiness.prepared && (
                  <Link href="/evidence" className="block rounded-lg border p-2.5 hover:border-primary/40">
                    {d.readiness.required - d.readiness.prepared} required submission artifact(s) missing
                  </Link>
                )}
                {!d.runningJobs.length && !d.pendingUpdates.length && (d.selected || d.ideas.length <= 1) && !(d.readiness && d.readiness.required > d.readiness.prepared) && (
                  <p className="text-muted-foreground">Nothing pending.</p>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Saved ideas</CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/ideas">
                    All ideas <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {d.ideas.length ? (
                  <ul className="divide-y">
                    {d.ideas.slice(0, 6).map(({ idea, assessment }) => (
                      <li key={idea.id}>
                        <Link href={`/ideas/${idea.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                          <span className="flex min-w-0 items-center gap-2">
                            <Lightbulb className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm font-medium">{idea.name}</span>
                            {idea.status === "selected" && (
                              <Badge tone="teal">
                                <BadgeCheck /> Selected
                              </Badge>
                            )}
                            {idea.origin === "sample" && <Badge tone="gray">Sample</Badge>}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{assessment?.weightedTotal != null ? `${assessment.weightedTotal} / 100 estimate` : "not assessed"}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={<Lightbulb />} title="No ideas yet" description="Pitch an idea by voice in the Judge's Room, or let Nova propose some." action={<Button asChild size="sm"><Link href="/judge">Pitch an idea</Link></Button>} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Research updates</CardTitle>
              </CardHeader>
              <CardContent>
                {d.activity.length ? (
                  <ul className="space-y-2.5">
                    {d.activity.map((a) => (
                      <li key={a.id} className="text-sm">
                        {a.href ? (
                          <Link href={a.href} className="hover:text-primary">
                            {a.message}
                          </Link>
                        ) : (
                          a.message
                        )}
                        <div className="text-xs text-muted-foreground">{relativeTime(a.createdAt)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent hackathons</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.hackathons.map((h) => (
                <Link key={h.id} href={`/hackathons/${h.id}`} className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{h.name}</span>
                    {h.origin === "cached_seed" && <Badge tone="gray">Cached demo</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{h.organizer ?? h.officialUrl}</div>
                  <div className="mt-3">{h.deadlineAt ? <Countdown deadline={h.deadlineAt.toISOString()} compact /> : <Badge tone="gray">Deadline not verified</Badge>}</div>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="grid gap-4 md:grid-cols-4">
          {[
            { icon: Compass, title: "1 · Verified event intelligence", text: "Rules, rubric weights, deadlines and deliverables, each tied to the official source text." },
            { icon: Radar, title: "2 · What already exists", text: "Real GitHub repos, Show HN launches and Devpost projects, compared by concept structure." },
            { icon: Gavel, title: "3 · The Judge's Room", text: "Defend your idea by voice. The assessment moves only when you add evidence." },
            { icon: Route, title: "4 · Plan and proof", text: "A plan that fits the real deadline, plus a board that maps each criterion to submission proof." },
          ].map((s) => (
            <Card key={s.title}>
              <CardContent className="pt-5">
                <s.icon className="mb-3 size-5 text-primary" />
                <div className="text-sm font-medium">{s.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <ScrollText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground">Eight specialists, one shared workspace</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map((a) => (
            <div key={a.name} className="rounded-xl border bg-card p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.role}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{a.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ClipboardCheck className="size-3.5" /> All scores are AI-assisted planning estimates. They are not official scores and don&apos;t predict a win.
        </p>
      </section>
    </div>
  );
}
