ALTER TABLE "platform"."analysis_execution_events" ADD COLUMN IF NOT EXISTS "step" jsonb;--> statement-breakpoint
ALTER TABLE "platform"."analysis_execution_events" ADD COLUMN IF NOT EXISTS "tool" jsonb;--> statement-breakpoint
