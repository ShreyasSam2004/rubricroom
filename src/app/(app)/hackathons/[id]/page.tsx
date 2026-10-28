import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowRight, BadgeCheck, Ban, CalendarClock, CircleAlert, ClipboardCheck, Clock, ExternalLink, Gavel, Globe, Info, Layers, ListChecks, Radar, Scale, ShieldAlert, Trophy, Users } from "lucide-react";
import { ExampleBanner } from "@/components/examples/example-banner";
import { AttachDocument, LiveJob, RerunResearch, SetActive, SourceActions } from "@/components/hackathon/research-actions";
import { CachedBadge, CoverageBadge, MethodBadge, OverlapBadge, VerificationBadge } from "@/components/research/badges";
import { ClaimCitation, type CitationClaim } from "@/components/research/claim-citation";
import { CoverageList } from "@/components/research/coverage";
import { Countdown } from "@/components/shell/countdown";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { Badge, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { citationMap, firstClaim } from "@/lib/citations";
import { getDb } from "@/lib/db/client";
import { opportunitySets } from "@/lib/db/schema";
import { pageContext } from "@/lib/page-context";
import { isTerminal } from "@/lib/research/jobs";
import { authorityLabel } from "@/lib/research/verify";
import { WEIGHT_BASIS_LABEL } from "@/lib/scoring";
import { getHackathonBundle } from "@/lib/services/hackathons";
import { formatDeadline, hasTimeOfDay } from "@/lib/deadline";
import { cn, formatDateTime } from "@/lib/utils";
import type { DossierItem } from "@/lib/types";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  official_page: "Official page",
  official_rules: "Official rules",
  official_judging: "Official judging page",
  official_schedule: "Official schedule",
  official_faq: "Official FAQ",
  official_submission: "Official submission page",
  organizer_blog: "Organizer blog",
  secondary_coverage: "Secondary coverage",
  community_discussion: "Community discussion",
  devpost_project: "Devpost project",
  github_repo: "GitHub repository",
  hn_discussion: "Hacker News",
  product_site: "Product site",
  web_result: "Web result",
  user_pasted: "Pasted by you",
  user_pdf: "Uploaded PDF",
};

function ItemList({ items, icon: Icon, empty, cites }: { items: DossierItem[] | undefined; icon: typeof Info; empty: string; cites: Record<string, CitationClaim> }) {
  if (!items?.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {it.text} <ClaimCitation claim={it.claimIds[0] ? cites[it.claimIds[0]] : undefined} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function HackathonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; job?: string }> }) {
  const { id } = await params;
  const { tab, job: jobParam } = await searchParams;
  const { workspaceId, active } = await pageContext();
  const b = await getHackathonBundle(workspaceId, id);
  if (!b) notFound();
  const { hackathon: h, criteria, rules, claims, sources, projects, job } = b;
  const cites = citationMap(claims, sources);
  const cite = (ids: string[] | undefined, label?: string) => <ClaimCitation claim={ids?.[0] ? cites[ids[0]] : undefined} label={label} />;
  const runningJobId = jobParam ?? (job && !isTerminal(job.status) ? job.id : null);
  const d = h.dossier;
  const verified = claims.filter((c) => c.verification === "verified").length;
  const requirementClaims = claims.filter((c) => ["submission", "mandatory", "rule"].includes(c.field) && c.verification === "verified").length;
  const coverage = h.coverage.length ? h.coverage : job?.coverage ?? [];
  const deadlineClaim = firstClaim(cites, "deadline");
  const db = await getDb();
  const [opps] = await db.select().from(opportunitySets).where(and(eq(opportunitySets.workspaceId, workspaceId), eq(opportunitySets.hackathonId, h.id))).orderBy(desc(opportunitySets.createdAt)).limit(1);
  const weightBasis = criteria.some((c) => c.weightBasis === "markup_recovered") ? "markup_recovered" : criteria.every((c) => c.weight !== null) ? "official" : "illustrative";
  const totalWeight = criteria.reduce((s, c) => s + (c.weight ?? 0), 0);
  const cachedAt = sources.find((s) => s.cached)?.retrievedAt ?? null;

  return (
    <div className="space-y-6">
      <ExampleBanner workspaceId={workspaceId} seedKey={h.seedKey} hackathonId={h.id} />
      {/* Hero */}
      <section className="rounded-2xl border bg-card p-5 md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {h.origin === "cached_seed" ? <CachedBadge at={cachedAt} /> : <Badge tone="primary">Live research</Badge>}
              {active?.id === h.id ? <Badge tone="teal">Active hackathon</Badge> : null}
              {h.format && <Badge tone="outline">{h.format}</Badge>}
              {h.location && <Badge tone="outline">{h.location}</Badge>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl" data-testid="hackathon-title">
              {h.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {h.organizer && (
                <span>
                  by {h.organizer} {cite(firstClaim(cites, "organizer") ? [firstClaim(cites, "organizer")!.id] : [])}
                </span>
              )}
              {h.officialUrl && (
                <a href={h.officialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  <Globe className="size-3.5" /> {new URL(h.officialUrl).hostname.replace(/^www\./, "")}
                </a>
              )}
            </div>
            {d?.tracks.length ? (
              <div className="flex flex-wrap gap-1.5">
                {d.tracks.map((t) => (
                  <Badge key={t.name} tone="primary">
                    <Layers /> {t.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 rounded-xl border bg-muted/30 p-4 lg:w-80">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" /> Submission deadline
              </span>
              {deadlineClaim && <ClaimCitation claim={deadlineClaim} label="source" />}
            </div>
            <div className="mt-1 font-medium" data-testid="deadline">
              {formatDeadline(h)}
              {h.deadlineAt && !hasTimeOfDay(h) && <span className="ml-1 text-xs text-muted-foreground">(no time stated; counting to the end of the day{h.timezone ? `, ${h.timezone}` : ""})</span>}
              {h.deadlineAt && hasTimeOfDay(h) && h.timezone && <span className="ml-1 text-xs text-muted-foreground">({h.timezone})</span>}
            </div>
            {h.deadlineAt && <Countdown deadline={h.deadlineAt.toISOString()} className="mt-2" />}
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>Registration: {h.registrationStatus ? <span className="text-foreground">{h.registrationStatus}</span> : "not verified"}</div>
              <div>
                {requirementClaims} confirmed requirement(s) · {verified} of {claims.length} claims verified against the source text
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
          <RerunResearch hackathonId={h.id} label={h.origin === "cached_seed" ? "Re-run live research" : "Re-run research"} />
          {active?.id !== h.id && <SetActive hackathonId={h.id} />}
          <Button asChild size="sm">
            <Link href={`/judge?hackathon=${h.id}`}>
              <Gavel /> Challenge an idea
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/radar?hackathon=${h.id}`}>
              <Radar /> Find opportunities
            </Link>
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {h.origin === "cached_seed" ? "Cached dossier: shown from pages retrieved earlier, not a live search." : `Last updated ${formatDateTime(h.updatedAt)}`}
          </span>
        </div>
      </section>

      {runningJobId && <LiveJob jobId={runningJobId} hackathonId={h.id} />}
      {h.sourceStatus === "failed" && !runningJobId && (
        <Callout tone="danger" icon={<ShieldAlert />} title="Research could not retrieve this event">
          {job?.error ?? "No official page could be fetched."} Paste the rules text or upload a PDF in the Sources tab to continue.
        </Callout>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs defaultValue={tab ?? "overview"}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="judging" data-testid="tab-judging">
              Judging
            </TabsTrigger>
            <TabsTrigger value="tracks">Tracks</TabsTrigger>
            <TabsTrigger value="sponsors">Sponsors</TabsTrigger>
            <TabsTrigger value="projects">Existing Projects</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
            <TabsTrigger value="submission">Submission</TabsTrigger>
            <TabsTrigger value="sources" data-testid="tab-sources">
              Sources
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            {!d ? (
              <EmptyState icon={<Info />} title="No dossier yet" description="Research is still running or could not extract anything." />
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>In plain language</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-[15px] leading-relaxed">
                    <p>{d.summary || "Summary not available."}</p>
                    {d.whatToBuild && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">What a suitable project does: </span>
                        {d.whatToBuild}
                      </p>
                    )}
                  </CardContent>
                </Card>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Scale className="size-4 text-primary" /> What the judges explicitly reward
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ItemList cites={cites} items={d.judgesReward} icon={BadgeCheck} empty="No explicit judging guidance found." />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Ban className="size-4 text-coral" /> What the rules prohibit
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ItemList cites={cites} items={d.prohibited} icon={Ban} empty="No explicit prohibitions found." />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <ListChecks className="size-4 text-teal" /> Mandatory
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ItemList cites={cites} items={d.mandatory.slice(0, 10)} icon={CircleAlert} empty="No mandatory requirements found." />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Info className="size-4 text-muted-foreground" /> Recommendations (not required)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ItemList cites={cites} items={d.recommendations} icon={Info} empty="No recommendations found." />
                    </CardContent>
                  </Card>
                </div>
                {d.timeline.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="size-4" /> Timeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ol className="relative space-y-3 border-l pl-5">
                        {d.timeline.map((t, i) => (
                          <li key={i} className="text-sm">
                            <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                            <span className="font-medium">{t.dateText}</span> — {t.label} {cite(t.claimIds)}
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                )}
                {(d.conflicts.length > 0 || d.uncertainties.length > 0 || d.extractionNotes.length > 0) && (
                  <Card>
                    <CardHeader>
                      <CardTitle>What remains uncertain</CardTitle>
                      <CardDescription>RubricRoom shows gaps and disagreements instead of guessing.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {d.conflicts.map((c, i) => (
                        <Callout key={i} tone="warning" icon={<CircleAlert />} title={`Conflicting sources: ${c.field.replace("_", " ")}`}>
                          <ul className="mt-1 space-y-1">
                            {c.values.map((v, j) => (
                              <li key={j}>
                                “{v.value}” — {v.sourceTitle} (authority {v.authority}){v.publishedAt ? `, published ${v.publishedAt.slice(0, 10)}` : ""}
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-foreground">{c.reason}</p>
                        </Callout>
                      ))}
                      {d.uncertainties.map((u, i) => (
                        <div key={i} className="flex gap-2 text-sm text-muted-foreground">
                          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {u}
                        </div>
                      ))}
                      {d.extractionNotes.map((n, i) => (
                        <div key={`n${i}`} className="flex gap-2 text-sm text-muted-foreground">
                          <Info className="mt-0.5 size-4 shrink-0" /> {n}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="rules">
            {rules.length === 0 ? (
              <EmptyState icon={<ListChecks />} title="No rules extracted" description="Attach the official rules page or PDF in the Sources tab." />
            ) : (
              <div className="space-y-4">
                {Object.entries(
                  rules.reduce<Record<string, typeof rules>>((acc, r) => {
                    (acc[r.category] ??= []).push(r);
                    return acc;
                  }, {}),
                ).map(([cat, list]) => (
                  <Card key={cat}>
                    <CardHeader>
                      <CardTitle className="capitalize">{cat}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="divide-y">
                        {list.map((r) => (
                          <li key={r.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                            <span className="text-sm leading-relaxed">
                              {r.text} {cite(r.claimIds)}
                            </span>
                            <Badge tone={r.level === "mandatory" ? "coral" : r.level === "recommended" ? "primary" : "gray"} className="shrink-0">
                              {r.level === "mandatory" ? "Mandatory" : r.level === "recommended" ? "Recommended" : "Unclear"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="judging" className="space-y-4">
            {criteria.length === 0 ? (
              <EmptyState icon={<Scale />} title="Judging criteria not found" description="No rubric was found in the retrieved pages. Any weighting RubricRoom uses will be labelled illustrative." />
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Official judging criteria</CardTitle>
                    <CardDescription>
                      {WEIGHT_BASIS_LABEL[weightBasis]}
                      {totalWeight ? ` · weights sum to ${totalWeight}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4" data-testid="criteria-list">
                    {criteria.map((c) => (
                      <div key={c.id} className="space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium">{c.name}</div>
                            {c.description && <div className="text-sm text-muted-foreground">{c.description}</div>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xl font-semibold tabular-nums" data-testid="criterion-weight">
                              {c.weight !== null ? `${c.weight}%` : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${c.weight ?? 0}%` }} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <VerificationBadge status={c.verification} />
                          {c.weightBasis === "markup_recovered" && <Badge tone="amber">Weight recovered from page markup</Badge>}
                          {cite(c.claimIds)}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                {weightBasis === "markup_recovered" && (
                  <Callout tone="info" icon={<Info />} title="Why “recovered from page markup”?">
                    The official judging page animates its weights from 0%, so the static text reads “0%” for every criterion. RubricRoom recovered the real values from the page&apos;s own HTML, where each value sits right before its criterion&apos;s label. They sum to {totalWeight}. Open the source to check.
                  </Callout>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="tracks">
            {d?.tracks.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {d.tracks.map((t) => (
                  <Card key={t.name}>
                    <CardHeader>
                      <CardDescription>{t.audience}</CardDescription>
                      <CardTitle className="text-lg">{t.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>{t.description}</p>
                      {cite(t.claimIds)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Layers />} title="No tracks found" description="The retrieved pages don't list separate tracks." />
            )}
            {d?.prizes.length ? (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="size-4 text-amber" /> Prizes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ItemList cites={cites} items={d.prizes} icon={Trophy} empty="" />
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="sponsors">
            {d?.sponsors.length ? (
              <div className="space-y-4">
                {d.sponsors.map((s) => (
                  <Card key={s.name}>
                    <CardHeader>
                      <CardTitle>{s.name}</CardTitle>
                      <CardDescription>Verified sponsor technology</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>
                        <span className="font-medium">Usage requirement: </span>
                        {s.usageRequirement} {cite(s.claimIds)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
                <Callout tone="neutral" icon={<Info />}>
                  Opportunity Radar&apos;s Sponsor mode looks at what this technology uniquely enables and how to tell authentic use from decoration.
                </Callout>
              </div>
            ) : (
              <EmptyState icon={<Users />} title="No sponsor technology identified" description="No usage requirement for a sponsor technology was found in the retrieved pages." />
            )}
          </TabsContent>

          <TabsContent value="projects">
            {projects.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {projects.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border bg-card p-4 hover:border-primary/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.similarity ? <OverlapBadge level={p.similarity.level} /> : <Badge tone="gray">{p.sourcePlatform}</Badge>}
                    </div>
                    {p.description && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>}
                    <div className="mt-2 flex items-center gap-1 text-xs text-primary">
                      Open source <ExternalLink className="size-3" />
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Radar />}
                title="No public submissions found for this event"
                description={coverage.find((c) => c.key === "public_submissions")?.detail ?? "Run competitor research from an idea to compare it with existing projects."}
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/ideas">Research competitors for an idea</Link>
                  </Button>
                }
              />
            )}
          </TabsContent>

          <TabsContent value="opportunities">
            <Card>
              <CardHeader>
                <CardTitle>Opportunity Radar</CardTitle>
                <CardDescription>Less crowded directions for this hackathon, grounded in real public signals.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {opps?.cards.length ? (
                  <ul className="space-y-2">
                    {opps.cards.slice(0, 4).map((c) => (
                      <li key={c.name} className="rounded-lg border p-3 text-sm">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-muted-foreground">{c.pitch}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No opportunities generated yet for this hackathon.</p>
                )}
                <Button asChild size="sm">
                  <Link href={`/radar?hackathon=${h.id}`}>
                    Open Opportunity Radar <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="submission">
            {d?.submission.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="size-4 text-teal" /> Required deliverables
                  </CardTitle>
                  <CardDescription>Track proof for each one on the Evidence Board.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3" data-testid="submission-list">
                    {d.submission.map((s, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal">{i + 1}</span>
                        <div>
                          <div>
                            {s.label} {cite(s.claimIds)}
                          </div>
                          {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <Button asChild size="sm" variant="secondary" className="mt-4">
                    <Link href="/evidence">
                      Open Evidence Board <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <EmptyState icon={<ClipboardCheck />} title="Submission requirements not found" description="No explicit list of deliverables was found in the retrieved pages." />
            )}
          </TabsContent>

          <TabsContent value="sources" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Retrieved sources</CardTitle>
                <CardDescription>Every claim links back to one of these. External content is treated as data, never as instructions.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y" data-testid="source-list">
                  {sources.map((s) => (
                    <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.title ?? s.url}</div>
                        <div className="truncate text-xs text-muted-foreground">{s.finalUrl ?? s.url}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone="outline">{SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}</Badge>
                          <Badge tone="default">
                            Authority {s.authority}: {authorityLabel(s.authority)}
                          </Badge>
                          {s.cached && <CachedBadge at={s.retrievedAt} />}
                          {s.status !== "retrieved" && <Badge tone={s.status === "failed" || s.status === "blocked" ? "coral" : "amber"}>{s.status}</Badge>}
                          {s.markupHints.length > 0 && <Badge tone="amber">{s.markupHints.filter((x) => x.label).length} markup values recovered</Badge>}
                        </div>
                        {s.error && <p className="mt-1 text-xs text-coral">{s.error}</p>}
                        {s.retrievedAt && <p className="mt-1 text-xs text-muted-foreground">Retrieved {formatDateTime(s.retrievedAt)}</p>}
                      </div>
                      <SourceActions sourceId={s.id} url={s.finalUrl ?? s.url} status={s.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Attach a missing official document</CardTitle>
                <CardDescription>Add a rules page, FAQ or PDF the crawler didn&apos;t find, then re-run research.</CardDescription>
              </CardHeader>
              <CardContent>
                <AttachDocument hackathonId={h.id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Research coverage</CardTitle>
              <CardDescription>What RubricRoom checked, and what it didn&apos;t.</CardDescription>
            </CardHeader>
            <CardContent data-testid="coverage">
              <CoverageList items={coverage} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How to read this</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <VerificationBadge status="verified" /> quote found verbatim in an official source
              </div>
              <div className="flex items-center gap-2">
                <VerificationBadge status="partially_verified" /> paraphrased, assumed or lower authority
              </div>
              <div className="flex items-center gap-2">
                <VerificationBadge status="not_verified" /> couldn&apos;t be matched to retrieved text
              </div>
              <div className="flex items-center gap-2">
                <MethodBadge method={claims[0]?.method ?? "heuristic"} /> how the claim was extracted
              </div>
              {coverage.some((c) => c.status === "not_configured") && (
                <div className="flex items-start gap-2 pt-1">
                  <CoverageBadge status="not_configured" /> a provider key is missing, so this source wasn&apos;t searched
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
      <p className={cn("text-xs text-muted-foreground")}>Never treat this dossier as a substitute for the official rules. When in doubt, open the source.</p>
    </div>
  );
}
