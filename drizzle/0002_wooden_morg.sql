CREATE TABLE "platform"."agent_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"tool_name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_invocation_id" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"trace_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."analysis_execution_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"kind" text NOT NULL,
	"event_timestamp" timestamp with time zone NOT NULL,
	"status" text,
	"message" text,
	"render_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."analysis_execution_snapshots" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "platform"."analysis_execution_snapshots" ADD COLUMN "trace_id" text;--> statement-breakpoint
CREATE INDEX "agent_invocations_execution_kind_tool_idx" ON "platform"."agent_invocations" USING btree ("execution_id","kind","tool_name");--> statement-breakpoint
CREATE INDEX "agent_invocations_trace_idx" ON "platform"."agent_invocations" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "agent_invocations_parent_idx" ON "platform"."agent_invocations" USING btree ("parent_invocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_execution_events_execution_sequence_uidx" ON "platform"."analysis_execution_events" USING btree ("execution_id","sequence");--> statement-breakpoint
CREATE INDEX "analysis_execution_events_access_idx" ON "platform"."analysis_execution_events" USING btree ("session_id","execution_id","owner_user_id","sequence");--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_trace_id_idx" ON "platform"."analysis_execution_snapshots" USING btree ("trace_id");