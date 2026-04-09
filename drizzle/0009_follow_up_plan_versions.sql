ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN "plan_version" integer;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN "current_plan_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN "previous_plan_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN "current_plan_diff" jsonb;
