ALTER TABLE "debate_sessions" ADD COLUMN "opening_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hackathons" ADD COLUMN "deadline_has_time" boolean;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "active_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Deadlines given as a date only were stored as 00:00 UTC (shown as 5:30 am IST). They now count to the end of that day.
UPDATE "hackathons" SET "deadline_has_time" = false, "deadline_at" = "deadline_at" + interval '23 hours 59 minutes' WHERE "deadline_at" IS NOT NULL AND "timezone" IS NULL AND to_char("deadline_at" AT TIME ZONE 'UTC', 'HH24:MI:SS') = '00:00:00' AND coalesce("deadline_text", '') !~* '([0-9][:.][0-9]{2}|[0-9] ?(am|pm|a\.m\.|p\.m\.)|noon|midnight)';
