import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  BuilderProfileData,
  ClaimMethod,
  ClaimVerification,
  Confidence,
  CoverageItem,
  CriterionChange,
  CriterionResult,
  DebateClaim,
  DemoSegment,
  EventDossier,
  EvidenceRef,
  EvidenceStatus,
  FeasibilityReview,
  HeuristicDimensions,
  IdeaUpdateProposal,
  JobStep,
  MarkupHint,
  OpportunityCard,
  OriginalityReport,
  PlanArchitecture,
  PlanDay,
  PlanRisk,
  PlanTier,
  ProjectFingerprint,
  SimilarityResult,
  SourceStatus,
  SourceType,
  UrlCheck,
  WeightBasis,
} from "@/lib/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();

/** Anonymous, cookie-scoped workspace. Every user-owned row carries workspace_id. */
export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  activeHackathonId: text("active_hackathon_id"),
  activeIdeaId: text("active_idea_id"),
  /** Set when the visitor picks the active hackathon themselves; a passed deadline then doesn't move it. */
  activePinned: boolean("active_pinned").notNull().default(false),
  /** The past hackathon RubricRoom moved the workspace off; shown as a notice until dismissed. */
  switchedFromId: text("switched_from_id"),
  createdAt: created(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
});

export const builderProfiles = pgTable(
  "builder_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    data: jsonb("data").$type<BuilderProfileData>().notNull(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("builder_profiles_ws_idx").on(t.workspaceId)],
);

export const hackathons = pgTable(
  "hackathons",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    officialUrl: text("official_url"),
    organizer: text("organizer"),
    description: text("description"),
    theme: text("theme"),
    format: text("format"),
    location: text("location"),
    timezone: text("timezone"),
    deadlineAt: ts("deadline_at"),
    deadlineText: text("deadline_text"),
    /** False when the page gives only a date: deadline_at is then the end of that day. Null on older rows. */
    deadlineHasTime: boolean("deadline_has_time"),
    registrationStatus: text("registration_status"),
    dossier: jsonb("dossier").$type<EventDossier>(),
    coverage: jsonb("coverage").$type<CoverageItem[]>().notNull().default([]),
    sourceStatus: text("source_status").notNull().default("pending"), // pending | partial | complete | failed
    origin: text("origin").notNull().default("live"), // live | cached_seed
    seedKey: text("seed_key"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("hackathons_ws_idx").on(t.workspaceId)],
);

export const researchSources = pgTable(
  "research_sources",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id"),
    ideaId: text("idea_id"),
    researchJobId: text("research_job_id"),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    title: text("title"),
    publisher: text("publisher"),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    authority: integer("authority").notNull().default(7),
    publishedAt: ts("published_at"),
    retrievedAt: ts("retrieved_at"),
    excerpt: text("excerpt"),
    extractedText: text("extracted_text"),
    markupHints: jsonb("markup_hints").$type<MarkupHint[]>().notNull().default([]),
    contentHash: text("content_hash"),
    httpStatus: integer("http_status"),
    status: text("status").$type<SourceStatus>().notNull().default("retrieved"),
    error: text("error"),
    cached: boolean("cached").notNull().default(false),
    userReportedIssue: text("user_reported_issue"),
    createdAt: created(),
  },
  (t) => [
    index("sources_ws_idx").on(t.workspaceId),
    index("sources_hackathon_idx").on(t.hackathonId),
    index("sources_idea_idx").on(t.ideaId),
  ],
);

/** A single extracted fact with provenance (the "evidence record" for event facts). */
export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    sourceId: text("source_id"),
    quote: text("quote"),
    verification: text("verification").$type<ClaimVerification>().notNull(),
    confidence: text("confidence").$type<Confidence>().notNull().default("medium"),
    method: text("method").$type<ClaimMethod>().notNull(),
    note: text("note"),
    createdAt: created(),
  },
  (t) => [index("claims_hackathon_idx").on(t.hackathonId), index("claims_ws_idx").on(t.workspaceId)],
);

export const hackathonRules = pgTable(
  "hackathon_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id").notNull(),
    category: text("category").notNull(),
    text: text("text").notNull(),
    applicability: text("applicability"),
    level: text("level").notNull().default("unclear"), // mandatory | recommended | unclear
    claimIds: jsonb("claim_ids").$type<string[]>().notNull().default([]),
    verification: text("verification").$type<ClaimVerification>().notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("rules_hackathon_idx").on(t.hackathonId)],
);

export const judgingCriteria = pgTable(
  "judging_criteria",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id").notNull(),
    track: text("track"),
    name: text("name").notNull(),
    description: text("description"),
    weight: real("weight"),
    weightBasis: text("weight_basis").$type<WeightBasis>().notNull().default("illustrative"),
    position: integer("position").notNull().default(0),
    claimIds: jsonb("claim_ids").$type<string[]>().notNull().default([]),
    verification: text("verification").$type<ClaimVerification>().notNull(),
    quote: text("quote"),
  },
  (t) => [index("criteria_hackathon_idx").on(t.hackathonId)],
);

export const researchJobs = pgTable(
  "research_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id"),
    ideaId: text("idea_id"),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    steps: jsonb("steps").$type<JobStep[]>().notNull().default([]),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    budget: jsonb("budget").$type<Record<string, number>>().notNull().default({}),
    coverage: jsonb("coverage").$type<CoverageItem[]>().notNull().default([]),
    error: text("error"),
    lockedUntil: ts("locked_until"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("jobs_ws_idx").on(t.workspaceId), index("jobs_idea_idx").on(t.ideaId)],
);

export const existingProjects = pgTable(
  "existing_projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id"),
    ideaId: text("idea_id"),
    researchJobId: text("research_job_id"),
    name: text("name").notNull(),
    url: text("url").notNull(),
    repoUrl: text("repo_url"),
    sourcePlatform: text("source_platform").notNull(), // devpost | github | hackernews | web | producthunt
    description: text("description"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    audience: text("audience"),
    implementationEvidence: text("implementation_evidence"),
    publishedAt: ts("published_at"),
    lastVerifiedAt: ts("last_verified_at"),
    fingerprint: jsonb("fingerprint").$type<ProjectFingerprint>(),
    similarity: jsonb("similarity").$type<SimilarityResult>(),
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    imageUrl: text("image_url"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    verification: text("verification").$type<ClaimVerification>().notNull().default("partially_verified"),
    cached: boolean("cached").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("projects_ws_idx").on(t.workspaceId), index("projects_idea_idx").on(t.ideaId)],
);

export const projectIdeas = pgTable(
  "project_ideas",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id"),
    name: text("name").notNull(),
    status: text("status").notNull().default("candidate"), // candidate | selected | archived
    origin: text("origin").notNull().default("user"), // user | nova | sample
    currentVersionId: text("current_version_id"),
    latestAssessmentId: text("latest_assessment_id"),
    personalRelevance: jsonb("personal_relevance").$type<{ experiences: boolean | null; example: string }>(),
    opportunity: jsonb("opportunity").$type<OpportunityCard>(),
    feasibility: jsonb("feasibility").$type<FeasibilityReview>(),
    originality: jsonb("originality").$type<OriginalityReport>(),
    selectedAt: ts("selected_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("ideas_ws_idx").on(t.workspaceId), index("ideas_hackathon_idx").on(t.hackathonId)],
);

/** Immutable snapshots of an idea. Never updated after insert. */
export const ideaVersions = pgTable(
  "idea_versions",
  {
    id: text("id").primaryKey(),
    ideaId: text("idea_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    userProblem: text("user_problem").notNull().default(""),
    targetAudience: text("target_audience").notNull().default(""),
    workflow: text("workflow").notNull().default(""),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    differentiators: jsonb("differentiators").$type<string[]>().notNull().default([]),
    sponsorUsage: text("sponsor_usage").notNull().default(""),
    techStack: jsonb("tech_stack").$type<string[]>().notNull().default([]),
    originalPitch: text("original_pitch"),
    pitchLanguage: text("pitch_language"),
    changeNote: text("change_note"),
    changeSource: text("change_source").notNull().default("user"), // user | debate | nova | merge | restore | sample
    parentVersionId: text("parent_version_id"),
    influencedBy: jsonb("influenced_by").$type<EvidenceRef[]>().notNull().default([]),
    createdAt: created(),
  },
  (t) => [uniqueIndex("idea_versions_unique").on(t.ideaId, t.version), index("idea_versions_ws_idx").on(t.workspaceId)],
);

export const ideaAssessments = pgTable(
  "idea_assessments",
  {
    id: text("id").primaryKey(),
    ideaId: text("idea_id").notNull(),
    ideaVersionId: text("idea_version_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    criterionResults: jsonb("criterion_results").$type<CriterionResult[]>().notNull(),
    heuristics: jsonb("heuristics").$type<HeuristicDimensions>().notNull(),
    weightedTotal: real("weighted_total"),
    weightBasis: text("weight_basis").$type<WeightBasis>().notNull(),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    concerns: jsonb("concerns").$type<string[]>().notNull().default([]),
    opening: jsonb("opening").$type<{ role: string; text: string }>(),
    weightNote: text("weight_note"),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    scoreModelVersion: text("score_model_version").notNull(),
    method: text("method").notNull(), // ai | heuristic
    model: text("model"),
    createdAt: created(),
  },
  (t) => [index("assessments_idea_idx").on(t.ideaId)],
);

export const assessmentRevisions = pgTable(
  "assessment_revisions",
  {
    id: text("id").primaryKey(),
    ideaId: text("idea_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    previousAssessmentId: text("previous_assessment_id").notNull(),
    newAssessmentId: text("new_assessment_id").notNull(),
    debateTurnId: text("debate_turn_id"),
    changes: jsonb("changes").$type<CriterionChange[]>().notNull(),
    reason: text("reason").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    createdAt: created(),
  },
  (t) => [index("revisions_idea_idx").on(t.ideaId)],
);

export const debateSessions = pgTable(
  "debate_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ideaId: text("idea_id").notNull(),
    hackathonId: text("hackathon_id"),
    mode: text("mode").notNull(),
    focus: text("focus"),
    intensity: integer("intensity").notNull().default(2),
    track: text("track"),
    language: text("language").notNull().default("en"),
    status: text("status").notNull().default("active"),
    acceptedClaims: jsonb("accepted_claims").$type<DebateClaim[]>().notNull().default([]),
    rejectedClaims: jsonb("rejected_claims").$type<DebateClaim[]>().notNull().default([]),
    outstandingConcerns: jsonb("outstanding_concerns").$type<string[]>().notNull().default([]),
    nextActions: jsonb("next_actions").$type<string[]>().notNull().default([]),
    initialAssessmentId: text("initial_assessment_id"),
    currentAssessmentId: text("current_assessment_id"),
    /** Lease held while one request writes the opening question and scores the idea. */
    openingUntil: ts("opening_until"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("debates_ws_idx").on(t.workspaceId), index("debates_idea_idx").on(t.ideaId)],
);

export const debateTurns = pgTable(
  "debate_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    speaker: text("speaker").notNull(), // user | judge | system
    judgeRole: text("judge_role"),
    text: text("text").notNull(),
    claims: jsonb("claims").$type<DebateClaim[]>().notNull().default([]),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    revisionId: text("revision_id"),
    ideaUpdate: jsonb("idea_update").$type<IdeaUpdateProposal & { status: "proposed" | "applied" | "dismissed"; versionId?: string }>(),
    method: text("method"), // ai | heuristic
    createdAt: created(),
  },
  (t) => [index("turns_session_idx").on(t.sessionId)],
);

export const buildPlans = pgTable(
  "build_plans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ideaId: text("idea_id").notNull(),
    ideaVersionId: text("idea_version_id"),
    deadlineAt: ts("deadline_at"),
    hoursPerDay: real("hours_per_day").notNull(),
    totalHours: real("total_hours").notNull(),
    tiers: jsonb("tiers").$type<PlanTier[]>().notNull(),
    architecture: jsonb("architecture").$type<PlanArchitecture>().notNull(),
    days: jsonb("days").$type<PlanDay[]>().notNull(),
    risks: jsonb("risks").$type<PlanRisk[]>().notNull(),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    postDeadline: boolean("post_deadline").notNull().default(false),
    method: text("method").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("plans_ws_idx").on(t.workspaceId), index("plans_idea_idx").on(t.ideaId)],
);

export const buildTasks = pgTable(
  "build_tasks",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    day: integer("day").notNull(),
    tier: text("tier").notNull().default("core"),
    priority: text("priority").notNull().default("medium"), // high | medium | low
    dueAt: ts("due_at"),
    status: text("status").notNull().default("todo"), // todo | doing | done | blocked | cut
    dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
    acceptance: text("acceptance"),
    notes: text("notes"),
    proofUrl: text("proof_url"),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    estimateHours: real("estimate_hours"),
    position: integer("position").notNull().default(0),
    updatedAt: updated(),
  },
  (t) => [index("tasks_plan_idx").on(t.planId)],
);

export const demoPlans = pgTable(
  "demo_plans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ideaId: text("idea_id").notNull(),
    timeLimitSec: integer("time_limit_sec").notNull(),
    hook: text("hook").notNull(),
    segments: jsonb("segments").$type<DemoSegment[]>().notNull(),
    closing: text("closing").notNull(),
    checklist: jsonb("checklist").$type<string[]>().notNull(),
    excludedFeatures: jsonb("excluded_features").$type<string[]>().notNull().default([]),
    refinements: jsonb("refinements").$type<string[]>().notNull().default([]),
    method: text("method").notNull(),
    createdAt: created(),
  },
  (t) => [index("demo_idea_idx").on(t.ideaId)],
);

export const submissionEvidence = pgTable(
  "submission_evidence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id").notNull(),
    ideaId: text("idea_id"),
    criterionId: text("criterion_id"),
    deliverableKey: text("deliverable_key"),
    artifactType: text("artifact_type").notNull(), // url | video | screenshot | note | usage_card | test_report | repo
    title: text("title").notNull(),
    url: text("url"),
    notes: text("notes"),
    uploadId: text("upload_id"),
    status: text("status").$type<EvidenceStatus>().notNull().default("submitted"),
    check: jsonb("check").$type<UrlCheck>(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("evidence_ws_idx").on(t.workspaceId), index("evidence_hackathon_idx").on(t.hackathonId)],
);

export const uploads = pgTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdAt: created(),
  },
  (t) => [index("uploads_ws_idx").on(t.workspaceId)],
);

/** Fixed-window counters for rate limits and search budgets. */
export const usageCounters = pgTable("usage_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
});

/** Audit trail of every model call, so each AI-visible action is traceable. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    agent: text("agent").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: created(),
  },
  (t) => [index("ai_calls_ws_idx").on(t.workspaceId)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    href: text("href"),
    createdAt: created(),
  },
  (t) => [index("activity_ws_idx").on(t.workspaceId)],
);

export const opportunitySets = pgTable(
  "opportunity_sets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    hackathonId: text("hackathon_id"),
    researchJobId: text("research_job_id"),
    mode: text("mode").notNull(),
    modifiers: jsonb("modifiers").$type<string[]>().notNull().default([]),
    request: text("request"),
    cards: jsonb("cards").$type<OpportunityCard[]>().notNull().default([]),
    signals: jsonb("signals").$type<{ label: string; url?: string; detail?: string; kind: string }[]>().notNull().default([]),
    diversityNotes: jsonb("diversity_notes").$type<string[]>().notNull().default([]),
    method: text("method").notNull(),
    createdAt: created(),
  },
  (t) => [index("opps_ws_idx").on(t.workspaceId)],
);
