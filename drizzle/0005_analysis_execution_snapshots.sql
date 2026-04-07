CREATE TABLE "platform"."analysis_execution_snapshots" (
	"execution_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" text NOT NULL,
	"plan_snapshot" jsonb NOT NULL,
	"step_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusion_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mobile_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_point" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_session_id_idx" ON "platform"."analysis_execution_snapshots" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_owner_updated_idx" ON "platform"."analysis_execution_snapshots" USING btree ("owner_user_id","updated_at");
