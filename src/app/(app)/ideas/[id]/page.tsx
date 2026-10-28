import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BadgeCheck, CircleAlert, Gavel, GitBranch, History, Info, Lightbulb, Minus, Plus, Quote, Radar, Scale, ShieldCheck, Wrench } from "lucide-react";
import { ExampleBanner } from "@/components/examples/example-banner";
import { CompetitorCard } from "@/components/ideas/competitor-card";
import { DictateChange, EditIdea, FeasibilityButton, IdeaToolbar, MergeFromVersion, PersonalRelevance, ResearchCompetitors, VersionActions } from "@/components/ideas/idea-actions";
import { Delta, HeuristicPanel, RubricPanel } from "@/components/ideas/rubric-panel";
import { OVERLAP_META } from "@/components/research/badges";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { Badge, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { pageContext } from "@/lib/page-context";
import { isTerminal } from "@/lib/research/jobs";
import { getIdeaBundle, versionToFields } from "@/lib/services/ideas";
import { formatDateTime, relativeTime } from "@/lib/utils";
import type { IdeaFields } from "@/lib/types";

type Version = NonNullable<Awaited<ReturnType<typeof getIdeaBundle>>>["versions"][number];

function diffVersions(older: Version | undefined, newer: Version) {
  if (!older) return [];
  const a = versionToFields(older);
  const b = versionToFields(newer);
  const out: { field: string; removed?: string[]; added?: string[]; from?: string; to?: string }[] = [];
  for (const key of Object.keys(b) as (keyof IdeaFields)[]) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      const removed = x.filter((v) => !y.includes(v));
      const added = y.filter((v) => !x.includes(v));
      if (removed.length || added.length) out.push({ field: key, removed, added });
    } else if (x !== y) out.push({ field: key, from: String(x), to: String(y) });
  }
  return out;
}

export default async function IdeaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; change?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspaceId } = await pageContext();
  const b = await getIdeaBundle(workspaceId, id);
  if (!b) notFound();
  const { idea, current, versions, latest, assessments, revisions, projects, debates, jobs, hackathon } = b;
  const runningJob = jobs.find((j) => j.jobType === "idea_research" && !isTerminal(j.status));
  const fields = versionToFields(current);
  const firstAssessment = assessments[assessments.length - 1];
  const report = idea.originality;
  const feas = idea.feasibility;

  return (
    <div className="space-y-6">
      {hackathon && <ExampleBanner workspaceId={workspaceId} seedKey={hackathon.seedKey} hackathonId={hackathon.id} ideaId={idea.id} />}
      <section className="rounded-2xl border bg-card p-5 md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {idea.status === "selected" && (
                <Badge tone="teal">
                  <BadgeCheck /> Selected as your project
                </Badge>
              )}
              {idea.origin === "sample" && <Badge tone="gray">Sample idea (editable)</Badge>}
              {idea.origin === "nova" && <Badge tone="primary">From Opportunity Radar</Badge>}
              <Badge tone="outline">Version {current.version}</Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl" data-testid="idea-title">
              {idea.name}
            </h1>
            <p className="max-w-3xl text-[15px] text-muted-foreground">{current.summary}</p>
            {hackathon && (
              <Link href={`/hackathons/${hackathon.id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                For {hackathon.name} <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
          <IdeaToolbar ideaId={idea.id} selected={idea.status === "selected"} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Tabs key={sp.tab ?? "overview"} defaultValue={sp.tab ?? "overview"}>
          <TabsList>
            <TabsTrigger value="overview">Idea</TabsTrigger>
            <TabsTrigger value="assessment">Assessment &amp; audit trail</TabsTrigger>
            <TabsTrigger value="originality">Originality</TabsTrigger>
            <TabsTrigger value="feasibility">Feasibility</TabsTrigger>
            <TabsTrigger value="versions">Versions ({versions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Current definition</CardTitle>
                  <CardDescription>{current.changeNote ?? ""}</CardDescription>
                </div>
                <EditIdea ideaId={idea.id} fields={fields} />
              </CardHeader>
              <CardContent className="grid gap-4 text-sm md:grid-cols-2">
                {[
                  ["Problem", fields.userProblem],
                  ["Target user", fields.targetAudience],
                  ["Core workflow", fields.workflow],
                  ["Sponsor technology usage", fields.sponsorUsage],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-xs font-medium text-muted-foreground">{l}</div>
                    <div className="mt-0.5 leading-relaxed">{v || <span className="text-muted-foreground italic">Not stated yet</span>}</div>
                  </div>
                ))}
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Features</div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">{fields.features.length ? fields.features.map((f) => <li key={f}>{f}</li>) : <li className="list-none italic text-muted-foreground">None listed</li>}</ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Differentiators (claimed)</div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">{fields.differentiators.length ? fields.differentiators.map((f) => <li key={f}>{f}</li>) : <li className="list-none italic text-muted-foreground">None claimed</li>}</ul>
                </div>
                {current.originalPitch && (
                  <div className="md:col-span-2">
                    <div className="text-xs font-medium text-muted-foreground">Original pitch{current.pitchLanguage && current.pitchLanguage !== "en" ? ` (${current.pitchLanguage})` : ""}, preserved as written</div>
                    <blockquote className="mt-1 flex gap-2 rounded-lg bg-muted/50 p-3 leading-relaxed">
                      <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {current.originalPitch}
                    </blockquote>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Refine by voice</CardTitle>
                <CardDescription>Dictate a change. RubricRoom proposes the edit and only creates a new version once you confirm.</CardDescription>
              </CardHeader>
              <CardContent>
                <DictateChange ideaId={idea.id} initial={sp.change ?? ""} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Personal relevance</CardTitle>
              </CardHeader>
              <CardContent>
                <PersonalRelevance ideaId={idea.id} value={idea.personalRelevance} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assessment" className="space-y-4">
            {latest ? (
              <Card>
                <CardHeader>
                  <CardTitle>Against the official rubric</CardTitle>
                  <CardDescription>
                    Assessed {relativeTime(latest.createdAt)} · {latest.scoreModelVersion}
                    {latest.weightNote ? ` · ${latest.weightNote}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RubricPanel results={latest.criterionResults} previous={firstAssessment && firstAssessment.id !== latest.id ? firstAssessment.criterionResults : null} total={latest.weightedTotal} previousTotal={firstAssessment && firstAssessment.id !== latest.id ? firstAssessment.weightedTotal : null} basis={latest.weightBasis} method={latest.method} />
                  {latest.assumptions.length > 0 && (
                    <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                      {latest.assumptions.map((a, i) => (
                        <div key={i} className="flex gap-1.5">
                          <Info className="mt-px size-3 shrink-0" /> {a}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <EmptyState icon={<Scale />} title="Not assessed yet" description="Use Reassess, or start a Judge's Room session." />
            )}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="size-4" /> Assessment audit trail
                </CardTitle>
                <CardDescription>Every change to a rating, with its reason and the evidence behind it.</CardDescription>
              </CardHeader>
              <CardContent>
                {revisions.length ? (
                  <ol className="space-y-3" data-testid="audit-trail">
                    {revisions.map((r) => (
                      <li key={r.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{formatDateTime(r.createdAt)}</span>
                          {r.debateTurnId && <Badge tone="primary">From the Judge&apos;s Room</Badge>}
                        </div>
                        <p className="mt-1 text-sm">{r.reason}</p>
                        {r.changes.length ? (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {r.changes.map((c) => (
                              <li key={c.criterionId} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
                                {c.name} <Delta from={c.from} to={c.to} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">No rating changed.</p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">No revisions yet. Ratings change only when new evidence is added.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="originality" className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>What has already been tried, and what could still be different?</CardTitle>
                  <CardDescription>Absence of evidence is not evidence of uniqueness. The research never covers the whole web.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ResearchCompetitors ideaId={idea.id} runningJobId={runningJob?.id ?? null} hasResults={projects.length > 0} />
                {report ? (
                  <div className="space-y-4" data-testid="originality-report">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={report.confidence.level === "broad" ? "teal" : report.confidence.level === "moderate" ? "amber" : "gray"}>Research confidence: {report.confidence.level}</Badge>
                      <Badge tone="gray">{report.method === "ai" ? "Scout (AI)" : "Heuristic"}</Badge>
                      <span className="text-muted-foreground">{report.confidence.explanation}</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Closest existing projects</div>
                        {report.closest.length ? (
                          <ul className="space-y-1.5 text-sm">
                            {report.closest.map((c) => (
                              <li key={c.projectId}>
                                <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">
                                  {c.name}
                                </a>{" "}
                                <span className="text-xs text-muted-foreground">({OVERLAP_META[c.level].label})</span>
                                <div className="text-xs text-muted-foreground">{c.why}</div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">None with meaningful overlap in the reviewed sources.</p>
                        )}
                      </div>
                      <div>
                        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Possible differentiation</div>
                        <ul className="space-y-1 text-sm">
                          {report.differentiation.map((d, i) => (
                            <li key={i} className="flex gap-1.5">
                              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber" /> {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {report.overlappingFeatures.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Overlapping features</div>
                          <ul className="space-y-1 text-xs text-muted-foreground">
                            {report.overlappingFeatures.slice(0, 6).map((o, i) => (
                              <li key={i}>• {o}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {report.gaps.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Gaps in the reviewed evidence</div>
                          <ul className="space-y-1 text-xs text-muted-foreground">
                            {report.gaps.map((o, i) => (
                              <li key={i}>• {o}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Heuristic novelty assessment (0–5, not an objective measurement)</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(report.dimensions).map(([k, v]) => (
                          <div key={k} className="rounded-lg border p-2.5">
                            <div className="flex items-center justify-between text-sm">
                              <span className="capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                              <span className="font-medium tabular-nums">{v.rating}/5</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{v.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Callout tone="neutral" icon={<CircleAlert />} title="Research limitations">
                      <ul className="mt-1 space-y-0.5">
                        {report.limitations.map((l, i) => (
                          <li key={i}>• {l}</li>
                        ))}
                      </ul>
                    </Callout>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No originality report yet. Run competitor research to compare this idea with real projects.</p>
                )}
              </CardContent>
            </Card>
            {projects.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2" data-testid="competitors">
                {projects.map((p) => (
                  <CompetitorCard key={p.id} p={p} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="feasibility" className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="size-4" /> Forge feasibility review
                  </CardTitle>
                  <CardDescription>Estimates are ranges with stated assumptions. No model can know exact development time.</CardDescription>
                </div>
                <FeasibilityButton ideaId={idea.id} has={Boolean(feas)} />
              </CardHeader>
              <CardContent>
                {feas ? (
                  <div className="grid gap-4 text-sm md:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Implementation complexity</div>
                      <div className="text-lg font-semibold">{feas.complexity.rating}/5</div>
                      <div className="text-xs text-muted-foreground">{feas.complexity.rationale}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Demo reliability</div>
                      <div className="text-lg font-semibold">{feas.demoReliability.rating}/5</div>
                      <div className="text-xs text-muted-foreground">{feas.demoReliability.rationale}</div>
                    </div>
                    <div className="rounded-lg border p-3 md:col-span-2">
                      <div className="text-xs text-muted-foreground">Rough effort range</div>
                      <div className="text-lg font-semibold">
                        {feas.estimateHours.low}–{feas.estimateHours.high} hours
                      </div>
                      <ul className="mt-1 text-xs text-muted-foreground">
                        {feas.assumptions.map((a, i) => (
                          <li key={i}>• {a}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Integrations</div>
                      <ul className="space-y-1.5">
                        {feas.integrations.length ? (
                          feas.integrations.map((i) => (
                            <li key={i.name}>
                              <Badge tone={i.difficulty === "high" ? "coral" : i.difficulty === "medium" ? "amber" : "teal"}>{i.difficulty}</Badge> <span className="font-medium">{i.name}</span>
                              <div className="text-xs text-muted-foreground">{i.notes}</div>
                            </li>
                          ))
                        ) : (
                          <li className="text-muted-foreground">None detected</li>
                        )}
                      </ul>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">Suggested MVP</div>
                        <ul className="list-inside list-disc">{feas.mvp.map((m) => <li key={m}>{m}</li>)}</ul>
                      </div>
                      {feas.cut.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Consider cutting</div>
                          <ul className="list-inside list-disc text-coral">{feas.cut.map((m) => <li key={m}>{m}</li>)}</ul>
                        </div>
                      )}
                      {feas.deadlineRisks.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Deadline risks</div>
                          <ul className="space-y-1 text-xs">{feas.deadlineRisks.map((m) => <li key={m}>• {m}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No review yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="versions">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="size-4" /> Concept evolution
                </CardTitle>
                <CardDescription>Immutable versions. What changed, why, and what influenced it. This is explicit project memory; no model was retrained.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4" data-testid="versions">
                  {versions.map((v, i) => {
                    const diff = diffVersions(versions[i + 1], v);
                    const isCurrent = v.id === idea.currentVersionId;
                    return (
                      <li key={v.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">v{v.version}</span>
                            <span className="font-medium">{v.name}</span>
                            {isCurrent && <Badge tone="teal">Current</Badge>}
                            <Badge tone="gray">{v.changeSource}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{formatDateTime(v.createdAt)}</span>
                            <VersionActions ideaId={idea.id} versionId={v.id} isCurrent={isCurrent} />
                          </div>
                        </div>
                        {v.changeNote && <p className="mt-1 text-sm text-muted-foreground">{v.changeNote}</p>}
                        {v.influencedBy.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            {v.influencedBy.map((e, j) => (
                              <Badge key={j} tone="primary">
                                <Gavel /> {e.label}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {diff.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs">
                            {diff.map((d) => (
                              <li key={d.field}>
                                <span className="font-medium">{d.field}:</span>{" "}
                                {d.removed?.map((r) => (
                                  <span key={r} className="mr-1 inline-flex items-center gap-0.5 text-coral">
                                    <Minus className="size-3" />
                                    {r}
                                  </span>
                                ))}
                                {d.added?.map((r) => (
                                  <span key={r} className="mr-1 inline-flex items-center gap-0.5 text-teal">
                                    <Plus className="size-3" />
                                    {r}
                                  </span>
                                ))}
                                {d.to !== undefined && <span className="text-muted-foreground">“{d.from?.slice(0, 80)}” → “{d.to.slice(0, 120)}”</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {!isCurrent && (
                          <div className="mt-2 border-t pt-2">
                            <MergeFromVersion ideaId={idea.id} versionId={v.id} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <aside className="space-y-4">
          {latest && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" /> Rubric snapshot
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RubricPanel results={latest.criterionResults} total={latest.weightedTotal} basis={latest.weightBasis} method={latest.method} compact />
              </CardContent>
            </Card>
          )}
          {latest && (
            <Card>
              <CardHeader>
                <CardTitle>Beyond the rubric</CardTitle>
              </CardHeader>
              <CardContent>
                <HeuristicPanel heuristics={latest.heuristics} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Judge&apos;s Room sessions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {debates.length ? (
                debates.map((d) => (
                  <Link key={d.id} href={`/judge/${d.id}`} className="flex items-center justify-between rounded-lg border p-2.5 hover:border-primary/40">
                    <span className="capitalize">{d.mode} debate</span>
                    <span className="text-xs text-muted-foreground">{relativeTime(d.updatedAt)}</span>
                  </Link>
                ))
              ) : (
                <p className="text-muted-foreground">No debates yet.</p>
              )}
              <Link href={`/radar?base=${idea.id}`} className="flex items-center gap-1.5 pt-1 text-sm text-primary hover:underline">
                <Radar className="size-3.5" /> Find something better than this idea
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
