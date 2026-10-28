CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"agent" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"status" text NOT NULL,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"previous_assessment_id" text NOT NULL,
	"new_assessment_id" text NOT NULL,
	"debate_turn_id" text,
	"changes" jsonb NOT NULL,
	"reason" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idea_id" text NOT NULL,
	"idea_version_id" text,
	"deadline_at" timestamp with time zone,
	"hours_per_day" real NOT NULL,
	"total_hours" real NOT NULL,
	"tiers" jsonb NOT NULL,
	"architecture" jsonb NOT NULL,
	"days" jsonb NOT NULL,
	"risks" jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_deadline" boolean DEFAULT false NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"day" integer NOT NULL,
	"tier" text DEFAULT 'core' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'todo' NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance" text,
	"notes" text,
	"proof_url" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimate_hours" real,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"source_id" text,
	"quote" text,
	"verification" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idea_id" text NOT NULL,
	"hackathon_id" text,
	"mode" text NOT NULL,
	"focus" text,
	"intensity" integer DEFAULT 2 NOT NULL,
	"track" text,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"accepted_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outstanding_concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"initial_assessment_id" text,
	"current_assessment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"speaker" text NOT NULL,
	"judge_role" text,
	"text" text NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision_id" text,
	"idea_update" jsonb,
	"method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idea_id" text NOT NULL,
	"time_limit_sec" integer NOT NULL,
	"hook" text NOT NULL,
	"segments" jsonb NOT NULL,
	"closing" text NOT NULL,
	"checklist" jsonb NOT NULL,
	"excluded_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refinements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "existing_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text,
	"idea_id" text,
	"research_job_id" text,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"repo_url" text,
	"source_platform" text NOT NULL,
	"description" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" text,
	"implementation_evidence" text,
	"published_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"fingerprint" jsonb,
	"similarity" jsonb,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification" text DEFAULT 'partially_verified' NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"applicability" text,
	"level" text DEFAULT 'unclear' NOT NULL,
	"claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathons" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"official_url" text,
	"organizer" text,
	"description" text,
	"theme" text,
	"format" text,
	"location" text,
	"timezone" text,
	"deadline_at" timestamp with time zone,
	"deadline_text" text,
	"registration_status" text,
	"dossier" jsonb,
	"coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_status" text DEFAULT 'pending' NOT NULL,
	"origin" text DEFAULT 'live' NOT NULL,
	"seed_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL,
	"idea_version_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"criterion_results" jsonb NOT NULL,
	"heuristics" jsonb NOT NULL,
	"weighted_total" real,
	"weight_basis" text NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opening" jsonb,
	"weight_note" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_model_version" text NOT NULL,
	"method" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"user_problem" text DEFAULT '' NOT NULL,
	"target_audience" text DEFAULT '' NOT NULL,
	"workflow" text DEFAULT '' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differentiators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sponsor_usage" text DEFAULT '' NOT NULL,
	"tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_pitch" text,
	"pitch_language" text,
	"change_note" text,
	"change_source" text DEFAULT 'user' NOT NULL,
	"parent_version_id" text,
	"influenced_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judging_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text NOT NULL,
	"track" text,
	"name" text NOT NULL,
	"description" text,
	"weight" real,
	"weight_basis" text DEFAULT 'illustrative' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification" text NOT NULL,
	"quote" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text,
	"research_job_id" text,
	"mode" text NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request" text,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diversity_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"current_version_id" text,
	"latest_assessment_id" text,
	"personal_relevance" jsonb,
	"opportunity" jsonb,
	"feasibility" jsonb,
	"originality" jsonb,
	"selected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text,
	"idea_id" text,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"locked_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text,
	"idea_id" text,
	"research_job_id" text,
	"url" text NOT NULL,
	"final_url" text,
	"title" text,
	"publisher" text,
	"source_type" text NOT NULL,
	"authority" integer DEFAULT 7 NOT NULL,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone,
	"excerpt" text,
	"extracted_text" text,
	"markup_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text,
	"http_status" integer,
	"status" text DEFAULT 'retrieved' NOT NULL,
	"error" text,
	"cached" boolean DEFAULT false NOT NULL,
	"user_reported_issue" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hackathon_id" text NOT NULL,
	"idea_id" text,
	"criterion_id" text,
	"deliverable_key" text,
	"artifact_type" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"notes" text,
	"upload_id" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"check" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"active_hackathon_id" text,
	"active_idea_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_ws_idx" ON "activity_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_calls_ws_idx" ON "ai_calls" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "revisions_idea_idx" ON "assessment_revisions" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "plans_ws_idx" ON "build_plans" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "plans_idea_idx" ON "build_plans" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "tasks_plan_idx" ON "build_tasks" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "builder_profiles_ws_idx" ON "builder_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "claims_hackathon_idx" ON "claims" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "claims_ws_idx" ON "claims" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "debates_ws_idx" ON "debate_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "debates_idea_idx" ON "debate_sessions" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "turns_session_idx" ON "debate_turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "demo_idea_idx" ON "demo_plans" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "projects_ws_idx" ON "existing_projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_idea_idx" ON "existing_projects" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "rules_hackathon_idx" ON "hackathon_rules" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "hackathons_ws_idx" ON "hackathons" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "assessments_idea_idx" ON "idea_assessments" USING btree ("idea_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_versions_unique" ON "idea_versions" USING btree ("idea_id","version");--> statement-breakpoint
CREATE INDEX "idea_versions_ws_idx" ON "idea_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "criteria_hackathon_idx" ON "judging_criteria" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "opps_ws_idx" ON "opportunity_sets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ideas_ws_idx" ON "project_ideas" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ideas_hackathon_idx" ON "project_ideas" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "jobs_ws_idx" ON "research_jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "jobs_idea_idx" ON "research_jobs" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "sources_ws_idx" ON "research_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sources_hackathon_idx" ON "research_sources" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "sources_idea_idx" ON "research_sources" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "evidence_ws_idx" ON "submission_evidence" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "evidence_hackathon_idx" ON "submission_evidence" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "uploads_ws_idx" ON "uploads" USING btree ("workspace_id");