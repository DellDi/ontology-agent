ALTER TABLE "platform"."analysis_execution_snapshots"
    ADD COLUMN IF NOT EXISTS "capability_binding" jsonb;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
    ADD COLUMN IF NOT EXISTS "capability_binding" jsonb;
--> statement-breakpoint
UPDATE "platform"."analysis_execution_snapshots"
SET "capability_binding" = '{"source":"legacy/unknown"}'::jsonb
WHERE "capability_binding" IS NULL;
--> statement-breakpoint
UPDATE "platform"."analysis_session_follow_ups"
SET "capability_binding" = '{"source":"legacy/unknown"}'::jsonb
WHERE "capability_binding" IS NULL;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_execution_snapshots"
    ALTER COLUMN "capability_binding" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
    ALTER COLUMN "capability_binding" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_execution_snapshots"
    ALTER COLUMN "capability_binding" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
    ALTER COLUMN "capability_binding" DROP DEFAULT;
