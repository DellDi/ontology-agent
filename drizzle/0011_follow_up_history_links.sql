ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN IF NOT EXISTS "parent_follow_up_id" text;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN IF NOT EXISTS "result_execution_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_session_follow_ups_result_execution_idx"
  ON "platform"."analysis_session_follow_ups" ("result_execution_id");
--> statement-breakpoint
ALTER TABLE "platform"."analysis_execution_snapshots"
  ADD COLUMN IF NOT EXISTS "follow_up_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_execution_snapshots_follow_up_id_idx"
  ON "platform"."analysis_execution_snapshots" ("follow_up_id");
