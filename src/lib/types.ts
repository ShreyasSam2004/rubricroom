// Shared domain types. Persisted JSON columns are typed with these.

export type AgentName = "atlas" | "scout" | "nova" | "verdict" | "forge" | "prism" | "sprint" | "proof";

export type Confidence = "high" | "medium" | "low";

/** How trustworthy an extracted claim is, judged against the retrieved source text. */
export type ClaimVerification =
  | "verified" // value + quote found in a retrieved official source
  | "partially_verified" // value found, but quote paraphrased or source is lower authority
  | "not_verified" // could not be matched to retrieved text
  | "conflict" // sources disagree; see dossier.conflicts
  | "user_flagged"; // a user reported this extraction as incorrect

export type ClaimMethod = "ai" | "heuristic" | "curated" | "markup_recovered" | "user";

export type SourceType =
  | "official_page"
  | "official_rules"
  | "official_judging"
  | "official_schedule"
  | "official_faq"
  | "official_submission"
  | "organizer_blog"
  | "secondary_coverage"
  | "community_discussion"
  | "devpost_project"
  | "github_repo"
  | "hn_discussion"
  | "product_site"
  | "web_result"
  | "user_pasted"
  | "user_pdf";

export type SourceStatus = "retrieved" | "failed" | "outdated" | "changed" | "blocked";

/** A value recovered from page markup that the visible text misrepresents (e.g. animated "0%" counters). */
export interface MarkupHint {
  text: string;
  label?: string;
  value?: number;
}

export type JobType = "event" | "idea_research" | "opportunities";

export type JobStatus =
  | "queued"
  | "fetching_sources"
  | "extracting"
  | "searching_projects"
  | "exploring"
  | "evaluating"
  | "complete"
  | "partial"
  | "failed";

export type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "failed"
  | "not_configured"
  | "budget_exhausted";

export interface JobStep {
  key: string;
  label: string;
  agent: AgentName;
  status: StepStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
  counts?: Record<string, number>;
  attempts?: number;
}

export type CoverageStatus =
  | "verified"
  | "partial"
  | "not_available"
  | "not_searched"
  | "failed"
  | "not_configured";

export interface CoverageItem {
  key: string;
  label: string;
  status: CoverageStatus;
  detail?: string;
}

export interface DossierItem {
  text: string;
  detail?: string;
  claimIds: string[];
  level?: "mandatory" | "recommended" | "unclear";
}

export interface SubmissionRequirement {
  key: string;
  label: string;
  detail?: string;
  required: boolean;
  claimIds: string[];
}

export interface TimelineEntry {
  label: string;
  date: string | null; // ISO, when parseable
  dateText: string;
  claimIds: string[];
}

export interface ConflictValue {
  value: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  authority: number;
  publishedAt?: string | null;
  retrievedAt?: string | null;
}

export interface Conflict {
  field: string;
  values: ConflictValue[];
  preferred: string;
  reason: string;
}

export interface EventDossier {
  summary: string;
  whatToBuild: string;
  tracks: { name: string; audience: string; description: string; claimIds: string[] }[];
  prizes: DossierItem[];
  submission: SubmissionRequirement[];
  sponsors: { name: string; technology: string; usageRequirement: string; claimIds: string[] }[];
  judgesReward: DossierItem[];
  prohibited: DossierItem[];
  mandatory: DossierItem[];
  recommendations: DossierItem[];
  uncertainties: string[];
  timeline: TimelineEntry[];
  conflicts: Conflict[];
  extractionNotes: string[];
}

export interface ProjectFingerprint {
  targetUser: string;
  problem: string;
  workflow: string;
  input: string;
  transformation: string;
  output: string;
  technology: string;
  delivery: string;
  keywords: string[];
}

export type FingerprintDimension = Exclude<keyof ProjectFingerprint, "keywords">;

export type OverlapLevel = "strong" | "moderate" | "adjacent" | "different";

export interface SimilarityResult {
  score: number; // 0..1 heuristic
  level: OverlapLevel;
  dimensions: Record<FingerprintDimension, number>;
  overlaps: string[];
  differences: string[];
  method: "ai" | "heuristic";
}

export interface EvidenceRef {
  kind: "source" | "debate_claim" | "user_reported" | "competitor" | "submission_evidence" | "idea_text";
  id?: string;
  label: string;
  url?: string;
}

export interface CriterionResult {
  criterionId: string;
  name: string;
  weight: number | null;
  rating: number; // 0..5
  rationale: string;
  evidence: EvidenceRef[];
  gaps: string[];
  confidence: Confidence;
  suggestions: string[];
}

export interface HeuristicDimension {
  rating: number; // 0..5 (higher is better, except scopeRisk/competitorOverlap where higher = more risk)
  label: string;
  rationale: string;
}

export interface HeuristicDimensions {
  feasibility: HeuristicDimension;
  competitorOverlap: HeuristicDimension;
  personalRelevance: HeuristicDimension;
  researchConfidence: HeuristicDimension;
  demoReliability: HeuristicDimension;
  scopeRisk: HeuristicDimension;
}

export type WeightBasis = "official" | "markup_recovered" | "normalized" | "illustrative";

export type ClaimKind = "user_reported" | "verifiable" | "speculative" | "correction" | "differentiator";

export interface DebateClaim {
  id: string;
  text: string;
  kind: ClaimKind;
  status: "accepted" | "rejected" | "needs_evidence";
  reason: string;
  criterionIds: string[];
  evidenceUrl?: string;
  evidenceCheck?: { reachable: boolean; status?: number; title?: string; checkedAt: string; ownSite?: boolean };
}

export interface CriterionChange {
  criterionId: string;
  name: string;
  from: number;
  to: number;
  reason: string;
  claimIds: string[];
}

export interface IdeaFields {
  name: string;
  summary: string;
  userProblem: string;
  targetAudience: string;
  workflow: string;
  features: string[];
  differentiators: string[];
  sponsorUsage: string;
  techStack: string[];
}

export interface IdeaUpdateProposal {
  summary: string;
  changes: Partial<IdeaFields>;
  removedFeatures?: string[];
  addedFeatures?: string[];
}

export interface BuilderProfileData {
  mode: "solo" | "team";
  teamSize: number;
  languages: string[];
  frameworks: string[];
  experienceLevel: "beginner" | "intermediate" | "advanced";
  hoursPerDay: number;
  reusableProjects: string;
  apiBudget: "none" | "low" | "moderate" | "high";
  hardware: string;
  interests: string[];
  personalProblems: string;
  hasRealTester: boolean;
  targetTrack: string;
  desiredComplexity: "simple" | "balanced" | "ambitious";
  explanationLanguage: "en" | "hi" | "hinglish";
}

export interface OpportunityCard {
  name: string;
  pitch: string;
  targetUser: string;
  problem: string;
  problemEvidence: { label: string; url?: string; sourceId?: string; observed: boolean }[];
  howItWorks: string;
  demoMoment: string;
  differentiation: string;
  sponsorIntegration: string;
  components: string[];
  mvpScope: string[];
  risks: string[];
  feasibility: "low" | "medium" | "high";
  references: { label: string; url: string }[];
  assumptions: string[];
  fingerprint: ProjectFingerprint;
  mode: string;
}

export interface PlanTier {
  tier: "core" | "strong" | "optional";
  label: string;
  features: string[];
}

export interface PlanDay {
  day: number;
  date: string; // ISO date (YYYY-MM-DD)
  goal: string;
  hours: number;
  artifact: string;
  risks: string[];
}

export interface PlanRisk {
  id: string;
  category: "api" | "cost" | "auth" | "deployment" | "time" | "dependency" | "demo";
  description: string;
  likelihood: "low" | "medium" | "high";
  mitigation: string;
  scopeReduction?: string;
}

export interface PlanArchitecture {
  frontend: string;
  backend: string;
  ai: string;
  storage: string;
  integrations: string[];
  security: string[];
  deployment: string;
}

export interface DemoSegment {
  start: number; // seconds
  end: number;
  title: string;
  narration: string;
  onScreen: string;
  basedOn: string[]; // features/tasks actually implemented
}

export type EvidenceStatus = "missing" | "planned" | "submitted" | "auto_verified" | "needs_human";

export interface UrlCheck {
  checkedAt: string;
  reachable: boolean;
  httpStatus?: number;
  contentType?: string;
  title?: string;
  detail: string;
}

export interface FeasibilityReview {
  complexity: { rating: number; rationale: string }; // 1 = trivial … 5 = very hard
  integrations: { name: string; difficulty: "low" | "medium" | "high"; notes: string }[];
  externalDependencies: string[];
  testing: string;
  deployment: string;
  demoReliability: { rating: number; rationale: string }; // 5 = very reliable
  deadlineRisks: string[];
  mvp: string[];
  cut: string[];
  estimateHours: { low: number; high: number };
  assumptions: string[];
  method: "ai" | "heuristic";
  createdAt: string;
}

export interface NoveltyDimension {
  rating: number; // 0..5 heuristic
  rationale: string;
}

export interface OriginalityReport {
  closest: { projectId: string; name: string; url: string; level: OverlapLevel; why: string }[];
  overlappingFeatures: string[];
  gaps: string[];
  differentiation: string[];
  limitations: string[];
  confidence: { level: "broad" | "moderate" | "narrow" | "minimal"; explanation: string };
  dimensions: {
    workflowNovelty: NoveltyDimension;
    technicalNovelty: NoveltyDimension;
    framingNovelty: NoveltyDimension;
    uncommonCombination: NoveltyDimension;
    differentiationStrength: NoveltyDimension;
  };
  projectsReviewed: number;
  method: "ai" | "heuristic";
  createdAt: string;
  jobId: string | null;
}

export type CommandIntent =
  | "navigate"
  | "generate_ideas"
  | "compare_ideas"
  | "start_debate"
  | "update_idea"
  | "query_rubric"
  | "create_plan"
  | "update_milestone"
  | "query_evidence"
  | "explain_assessment"
  | "show_top_ideas"
  | "unknown";
