import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { forgeReview } from "@/lib/agents/forge";
import { structurePitch } from "@/lib/agents/prism";
import { assessIdea, heuristicAssessment, type VerdictContext } from "@/lib/agents/verdict";
import { describeAIError } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { jobSummaryColumns } from "@/lib/db/columns";
import {
  assessmentRevisions,
  debateSessions,
  existingProjects,
  hackathons,
  ideaAssessments,
  ideaVersions,
  judgingCriteria,
  projectIdeas,
  researchJobs,
  workspaces,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/research/jobs";
import { criteriaForTrack, normalizeWeights, SCORE_MODEL_VERSION, weightedTotal } from "@/lib/scoring";
import { clamp, detectLanguage, newId } from "@/lib/text";
import type { CriterionChange, CriterionResult, EvidenceRef, IdeaFields, IdeaUpdateProposal, OpportunityCard } from "@/lib/types";
import { getProfile } from "./profile";

export type IdeaRow = typeof projectIdeas.$inferSelect;
export type VersionRow = typeof ideaVersions.$inferSelect;
export type AssessmentRow = typeof ideaAssessments.$inferSelect;

export function versionToFields(v: VersionRow): IdeaFields {
  return {
    name: v.name,
    summary: v.summary,
    userProblem: v.userProblem,
    targetAudience: v.targetAudience,
    workflow: v.workflow,
    features: v.features,
    differentiators: v.differentiators,
    sponsorUsage: v.sponsorUsage,
    techStack: v.techStack,
  };
}

export async function getIdea(workspaceId: string, ideaId: string) {
  const db = await getDb();
  const [idea] = await db.select().from(projectIdeas).where(and(eq(projectIdeas.id, ideaId), eq(projectIdeas.workspaceId, workspaceId)));
  return idea ?? null;
}

export async function currentVersion(workspaceId: string, idea: IdeaRow): Promise<VersionRow> {
  const db = await getDb();
  const [v] = idea.currentVersionId
    ? await db.select().from(ideaVersions).where(and(eq(ideaVersions.id, idea.currentVersionId), eq(ideaVersions.workspaceId, workspaceId)))
    : await db.select().from(ideaVersions).where(and(eq(ideaVersions.ideaId, idea.id), eq(ideaVersions.workspaceId, workspaceId))).orderBy(desc(ideaVersions.version)).limit(1);
  return v;
}

/** Rubric + sponsor context for an idea's hackathon (track-filtered). */
export async function rubricContext(workspaceId: string, hackathonId: string | null, track?: string | null) {
  const db = await getDb();
  if (!hackathonId) return { hackathon: null, criteria: [] as (typeof judgingCriteria.$inferSelect)[], sponsors: [] as string[] };
  const [h] = await db.select().from(hackathons).where(and(eq(hackathons.id, hackathonId), eq(hackathons.workspaceId, workspaceId)));
  const all = await db.select().from(judgingCriteria).where(and(eq(judgingCriteria.hackathonId, hackathonId), eq(judgingCriteria.workspaceId, workspaceId))).orderBy(asc(judgingCriteria.position));
  const sponsors = (h?.dossier?.sponsors ?? []).map((s) => s.name);
  return { hackathon: h ?? null, criteria: criteriaForTrack(all, track), sponsors };
}

export async function buildVerdictContext(workspaceId: string, idea: IdeaRow, version: VersionRow, opts: { track?: string | null; language?: "en" | "hi" | "hinglish"; acceptedEvidence?: string[] } = {}): Promise<VerdictContext> {
  const db = await getDb();
  const { hackathon, criteria, sponsors } = await rubricContext(workspaceId, idea.hackathonId, opts.track);
  const competitors = await db.select().from(existingProjects).where(and(eq(existingProjects.workspaceId, workspaceId), eq(existingProjects.ideaId, idea.id)));
  const profile = await getProfile(workspaceId);
  return {
    workspaceId,
    hackathon: hackathon
      ? { name: hackathon.name, summary: hackathon.dossier?.summary ?? hackathon.description ?? "", sponsors, deadline: hackathon.deadlineAt?.toISOString() ?? null, track: opts.track ?? null }
      : null,
    criteria: criteria.map((c) => ({ id: c.id, name: c.name, description: c.description ?? "", weight: c.weight })),
    idea: { ...versionToFields(version), originalPitch: version.originalPitch },
    personalRelevance: idea.personalRelevance ?? null,
    competitors: competitors
      .filter((c) => c.similarity)
      .sort((a, b) => (b.similarity?.score ?? 0) - (a.similarity?.score ?? 0))
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, url: c.url, level: c.similarity!.level, summary: c.description ?? "" })),
    profile: profile.isDefault ? null : profile.data,
    language: opts.language ?? profile.data.explanationLanguage,
    acceptedEvidence: opts.acceptedEvidence,
  };
}

export interface CreateIdeaInput {
  hackathonId: string | null;
  pitch?: string;
  fields?: Partial<IdeaFields>;
  name?: string;
  origin?: "user" | "nova" | "sample";
  personalRelevance?: { experiences: boolean | null; example: string } | null;
  opportunity?: OpportunityCard | null;
}

export async function createIdea(workspaceId: string, input: CreateIdeaInput) {
  const db = await getDb();
  let fields: IdeaFields;
  let language: string | null = null;
  let structureMethod: "ai" | "heuristic" | "manual" = "manual";
  if (input.pitch && !input.fields) {
    const { sponsors } = await rubricContext(workspaceId, input.hackathonId);
    const s = await structurePitch(workspaceId, input.pitch, { sponsors, nameHint: input.name });
    fields = s.idea;
    language = s.language;
    structureMethod = s.method;
  } else {
    fields = {
      name: input.name ?? input.fields?.name ?? "Untitled idea",
      summary: input.fields?.summary ?? input.pitch ?? "",
      userProblem: input.fields?.userProblem ?? "",
      targetAudience: input.fields?.targetAudience ?? "",
      workflow: input.fields?.workflow ?? "",
      features: input.fields?.features ?? [],
      differentiators: input.fields?.differentiators ?? [],
      sponsorUsage: input.fields?.sponsorUsage ?? "",
      techStack: input.fields?.techStack ?? [],
    };
    if (input.pitch) language = detectLanguage(input.pitch);
  }
  const ideaId = newId("idea");
  const versionId = newId("ver");
  await db.transaction(async (tx) => {
    await tx.insert(projectIdeas).values({
      id: ideaId,
      workspaceId,
      hackathonId: input.hackathonId,
      name: fields.name,
      origin: input.origin ?? "user",
      currentVersionId: versionId,
      personalRelevance: input.personalRelevance ?? null,
      opportunity: input.opportunity ?? null,
    });
    await tx.insert(ideaVersions).values({
      id: versionId,
      ideaId,
      workspaceId,
      version: 1,
      ...fields,
      originalPitch: input.pitch ?? null,
      pitchLanguage: language,
      changeNote: structureMethod === "ai" ? "Structured from your pitch by Prism." : structureMethod === "heuristic" ? "Created from your pitch (offline structuring — edit fields to refine)." : "Created.",
      changeSource: input.origin === "sample" ? "sample" : input.origin === "nova" ? "nova" : "user",
    });
  });
  await logActivity(workspaceId, "idea", `New idea: ${fields.name}`, `/ideas/${ideaId}`);
  return { ideaId, versionId, fields };
}

/** Immutable versioning: every change creates version N+1; nothing is edited in place. */
export async function createVersion(
  workspaceId: string,
  ideaId: string,
  opts: { proposal?: IdeaUpdateProposal; fields?: Partial<IdeaFields>; note: string; source: "user" | "debate" | "merge" | "restore" | "branch"; influencedBy?: EvidenceRef[]; baseVersionId?: string },
) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found");
  const base = opts.baseVersionId
    ? (await db.select().from(ideaVersions).where(and(eq(ideaVersions.id, opts.baseVersionId), eq(ideaVersions.workspaceId, workspaceId))))[0]
    : await currentVersion(workspaceId, idea);
  const [latest] = await db.select({ version: ideaVersions.version }).from(ideaVersions).where(eq(ideaVersions.ideaId, ideaId)).orderBy(desc(ideaVersions.version)).limit(1);
  const fields = versionToFields(base);
  const changes = { ...(opts.proposal?.changes ?? {}), ...(opts.fields ?? {}) };
  let features = changes.features ?? fields.features;
  if (opts.proposal?.removedFeatures?.length) {
    const removed = opts.proposal.removedFeatures.map((f) => f.toLowerCase());
    features = features.filter((f) => !removed.includes(f.toLowerCase()));
  }
  if (opts.proposal?.addedFeatures?.length) features = [...features, ...opts.proposal.addedFeatures.filter((f) => !features.includes(f))];
  const next: IdeaFields = { ...fields, ...changes, features };
  const id = newId("ver");
  await db.insert(ideaVersions).values({
    id,
    ideaId,
    workspaceId,
    version: (latest?.version ?? 0) + 1,
    ...next,
    originalPitch: base.originalPitch,
    pitchLanguage: base.pitchLanguage,
    changeNote: opts.note,
    changeSource: opts.source,
    parentVersionId: base.id,
    influencedBy: opts.influencedBy ?? [],
  });
  await db.update(projectIdeas).set({ currentVersionId: id, name: next.name, updatedAt: new Date() }).where(eq(projectIdeas.id, ideaId));
  return { versionId: id, version: (latest?.version ?? 0) + 1, fields: next };
}

function diffResults(prev: CriterionResult[], next: CriterionResult[]): CriterionChange[] {
  return next
    .map((n) => {
      const p = prev.find((x) => x.criterionId === n.criterionId);
      return p && p.rating !== n.rating ? { criterionId: n.criterionId, name: n.name, from: p.rating, to: n.rating, reason: n.rationale, claimIds: [] } : null;
    })
    .filter(Boolean) as CriterionChange[];
}

/**
 * Assess the idea's current version against its hackathon's rubric. When a previous assessment
 * exists, ratings earned through debate evidence carry over (rule-based mode keeps the evidence
 * delta; AI mode is given the accepted claims) and a revision with the reason is recorded.
 */
export async function assessCurrentVersion(
  workspaceId: string,
  ideaId: string,
  opts: { reason?: string; debateTurnId?: string | null; track?: string | null; acceptedEvidence?: string[]; forceHeuristic?: boolean; onProgress?: (scored: number, total: number) => void } = {},
) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found");
  const version = await currentVersion(workspaceId, idea);
  const ctx = await buildVerdictContext(workspaceId, idea, version, { track: opts.track, acceptedEvidence: opts.acceptedEvidence });
  let out: Awaited<ReturnType<typeof assessIdea>>;
  if (opts.forceHeuristic) out = heuristicAssessment(ctx);
  else {
    try {
      out = await assessIdea(ctx, { onProgress: opts.onProgress });
    } catch (err) {
      // Never fail the user's action because the model is unavailable; say so on the assessment.
      out = heuristicAssessment(ctx);
      out.assumptions.unshift(`Verdict (AI) was unavailable (${await describeAIError(err)}), so this is the rule-based assessment.`);
    }
  }
  const prev = idea.latestAssessmentId ? (await db.select().from(ideaAssessments).where(eq(ideaAssessments.id, idea.latestAssessmentId)))[0] : null;

  if (prev && out.method === "heuristic" && prev.ideaVersionId !== version.id) {
    const [prevVersion] = await db.select().from(ideaVersions).where(eq(ideaVersions.id, prev.ideaVersionId));
    if (prevVersion) {
      const prevBaseline = heuristicAssessment({ ...ctx, idea: { ...versionToFields(prevVersion), originalPitch: prevVersion.originalPitch } }).results;
      for (const r of out.results) {
        const old = prev.criterionResults.find((x) => x.criterionId === r.criterionId);
        const base = prevBaseline.find((x) => x.criterionId === r.criterionId);
        if (old && base && old.rating > base.rating) {
          r.rating = clamp(r.rating + (old.rating - base.rating), 0, 4);
          r.evidence = [...r.evidence, ...old.evidence.filter((e) => e.kind === "debate_claim")];
          r.rationale = `${r.rationale} (Includes +${old.rating - base.rating} carried over from evidence accepted in the debate.)`;
        }
      }
    }
  }

  const { weights, basis, note } = normalizeWeights(ctx.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, weightBasis: undefined })));
  const critRows = await db.select().from(judgingCriteria).where(inArray(judgingCriteria.id, ctx.criteria.map((c) => c.id).length ? ctx.criteria.map((c) => c.id) : ["_"]));
  const realBasis = critRows.some((c) => c.weightBasis === "markup_recovered") && basis === "official" ? "markup_recovered" : basis;
  const id = newId("asm");
  const [row] = await db
    .insert(ideaAssessments)
    .values({
      id,
      ideaId,
      ideaVersionId: version.id,
      workspaceId,
      criterionResults: out.results,
      heuristics: out.heuristics,
      weightedTotal: ctx.criteria.length ? weightedTotal(out.results, weights) : null,
      weightBasis: realBasis,
      weightNote: note,
      assumptions: out.assumptions,
      concerns: out.concerns,
      opening: out.opening,
      scoreModelVersion: SCORE_MODEL_VERSION,
      method: out.method,
      model: out.model,
    })
    .returning();
  await db.update(projectIdeas).set({ latestAssessmentId: id, updatedAt: new Date() }).where(eq(projectIdeas.id, ideaId));
  let revision = null;
  if (prev) {
    const changes = diffResults(prev.criterionResults, out.results);
    [revision] = await db
      .insert(assessmentRevisions)
      .values({
        id: newId("rev"),
        ideaId,
        workspaceId,
        previousAssessmentId: prev.id,
        newAssessmentId: id,
        debateTurnId: opts.debateTurnId ?? null,
        changes,
        reason: opts.reason ?? `Reassessed version ${version.version}.`,
      })
      .returning();
  }
  return { assessment: row, revision, opening: out.opening };
}

/** Apply guarded debate changes to the current assessment, creating a new assessment + revision. */
export async function applyCriterionChanges(workspaceId: string, ideaId: string, base: AssessmentRow, changes: CriterionChange[], opts: { reason: string; debateTurnId: string; claimLabels: Map<string, string> }) {
  const db = await getDb();
  const results: CriterionResult[] = base.criterionResults.map((r) => {
    const ch = changes.find((c) => c.criterionId === r.criterionId);
    if (!ch) return r;
    return {
      ...r,
      rating: ch.to,
      rationale: `${ch.reason}`,
      evidence: [...r.evidence, ...ch.claimIds.map((id) => ({ kind: "debate_claim" as const, id, label: opts.claimLabels.get(id) ?? "Debate claim" }))],
      confidence: ch.to > ch.from ? "medium" : r.confidence,
    };
  });
  const weights = new Map<string, number>();
  const crit = await db.select().from(judgingCriteria).where(inArray(judgingCriteria.id, results.map((r) => r.criterionId).length ? results.map((r) => r.criterionId) : ["_"]));
  const norm = normalizeWeights(crit.map((c) => ({ id: c.id, name: c.name, weight: c.weight, weightBasis: c.weightBasis })));
  for (const [k, v] of norm.weights) weights.set(k, v);
  const id = newId("asm");
  const [row] = await db
    .insert(ideaAssessments)
    .values({
      ...base,
      id,
      criterionResults: results,
      weightedTotal: weightedTotal(results, weights),
      createdAt: new Date(),
    })
    .returning();
  const [revision] = await db
    .insert(assessmentRevisions)
    .values({ id: newId("rev"), ideaId, workspaceId, previousAssessmentId: base.id, newAssessmentId: id, debateTurnId: opts.debateTurnId, changes, reason: opts.reason })
    .returning();
  await db.update(projectIdeas).set({ latestAssessmentId: id, updatedAt: new Date() }).where(eq(projectIdeas.id, ideaId));
  return { assessment: row, revision };
}

export async function listIdeas(workspaceId: string, hackathonId?: string | null) {
  const db = await getDb();
  const where = hackathonId ? and(eq(projectIdeas.workspaceId, workspaceId), eq(projectIdeas.hackathonId, hackathonId)) : eq(projectIdeas.workspaceId, workspaceId);
  const ideas = await db.select().from(projectIdeas).where(where).orderBy(desc(projectIdeas.updatedAt));
  const assessmentIds = ideas.map((i) => i.latestAssessmentId).filter(Boolean) as string[];
  const assessments = assessmentIds.length ? await db.select().from(ideaAssessments).where(inArray(ideaAssessments.id, assessmentIds)) : [];
  const versionIds = ideas.map((i) => i.currentVersionId).filter(Boolean) as string[];
  const versions = versionIds.length ? await db.select().from(ideaVersions).where(inArray(ideaVersions.id, versionIds)) : [];
  return ideas.map((i) => ({
    idea: i,
    version: versions.find((v) => v.id === i.currentVersionId) ?? null,
    assessment: assessments.find((a) => a.id === i.latestAssessmentId) ?? null,
  }));
}

export async function getIdeaBundle(workspaceId: string, ideaId: string) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) return null;
  const [versions, assessments, revisions, projects, debates, jobs] = await Promise.all([
    db.select().from(ideaVersions).where(and(eq(ideaVersions.ideaId, ideaId), eq(ideaVersions.workspaceId, workspaceId))).orderBy(desc(ideaVersions.version)),
    db.select().from(ideaAssessments).where(and(eq(ideaAssessments.ideaId, ideaId), eq(ideaAssessments.workspaceId, workspaceId))).orderBy(desc(ideaAssessments.createdAt)),
    db.select().from(assessmentRevisions).where(and(eq(assessmentRevisions.ideaId, ideaId), eq(assessmentRevisions.workspaceId, workspaceId))).orderBy(desc(assessmentRevisions.createdAt)),
    db.select().from(existingProjects).where(and(eq(existingProjects.ideaId, ideaId), eq(existingProjects.workspaceId, workspaceId))),
    db.select().from(debateSessions).where(and(eq(debateSessions.ideaId, ideaId), eq(debateSessions.workspaceId, workspaceId))).orderBy(desc(debateSessions.updatedAt)),
    db.select(jobSummaryColumns).from(researchJobs).where(and(eq(researchJobs.ideaId, ideaId), eq(researchJobs.workspaceId, workspaceId))).orderBy(desc(researchJobs.createdAt)).limit(3),
  ]);
  const current = versions.find((v) => v.id === idea.currentVersionId) ?? versions[0];
  const hackathon = idea.hackathonId ? (await db.select().from(hackathons).where(and(eq(hackathons.id, idea.hackathonId), eq(hackathons.workspaceId, workspaceId))))[0] ?? null : null;
  return {
    idea,
    current,
    versions,
    assessments,
    latest: assessments.find((a) => a.id === idea.latestAssessmentId) ?? assessments[0] ?? null,
    revisions,
    projects: projects.sort((a, b) => (b.similarity?.score ?? 0) - (a.similarity?.score ?? 0)),
    debates,
    jobs,
    hackathon,
  };
}

export async function selectIdea(workspaceId: string, ideaId: string) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found");
  await db.update(projectIdeas).set({ status: "candidate", selectedAt: null }).where(and(eq(projectIdeas.workspaceId, workspaceId), eq(projectIdeas.status, "selected"), idea.hackathonId ? eq(projectIdeas.hackathonId, idea.hackathonId) : eq(projectIdeas.workspaceId, workspaceId)));
  await db.update(projectIdeas).set({ status: "selected", selectedAt: new Date(), updatedAt: new Date() }).where(eq(projectIdeas.id, ideaId));
  await db.update(workspaces).set({ activeIdeaId: ideaId }).where(eq(workspaces.id, workspaceId));
  await logActivity(workspaceId, "decision", `Selected “${idea.name}” as the project`, `/ideas/${ideaId}`);
}

export async function unselectIdea(workspaceId: string, ideaId: string) {
  const db = await getDb();
  await db.update(projectIdeas).set({ status: "candidate", selectedAt: null, updatedAt: new Date() }).where(and(eq(projectIdeas.id, ideaId), eq(projectIdeas.workspaceId, workspaceId)));
  await logActivity(workspaceId, "decision", "Reopened the project decision", `/compare`);
}

export async function refreshFeasibility(workspaceId: string, ideaId: string) {
  const db = await getDb();
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found");
  const version = await currentVersion(workspaceId, idea);
  const { hackathon, sponsors } = await rubricContext(workspaceId, idea.hackathonId);
  const profile = await getProfile(workspaceId);
  const hours = hackathon?.deadlineAt ? Math.max(0, ((hackathon.deadlineAt.getTime() - Date.now()) / 86_400_000) * profile.data.hoursPerDay) : null;
  const review = await forgeReview(workspaceId, versionToFields(version), profile.isDefault ? null : profile.data, hours, sponsors);
  await db.update(projectIdeas).set({ feasibility: review, updatedAt: new Date() }).where(eq(projectIdeas.id, ideaId));
  return review;
}
