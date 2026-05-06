CREATE TABLE "platform"."analysis_ui_message_projections" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"follow_up_id" text,
	"history_round_id" text,
	"projection_version" integer NOT NULL,
	"part_schema_version" integer NOT NULL,
	"contract_version" integer NOT NULL,
	"status" text NOT NULL,
	"is_terminal" boolean NOT NULL,
	"stream_cursor" jsonb DEFAULT '{"lastSequence":0,"lastEventId":null}'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recovery_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analysis_ui_message_projection_owner_session_idx" ON "platform"."analysis_ui_message_projections" USING btree ("owner_user_id","session_id");--> statement-breakpoint
CREATE INDEX "analysis_ui_message_projection_owner_execution_idx" ON "platform"."analysis_ui_message_projections" USING btree ("owner_user_id","execution_id");--> statement-breakpoint
CREATE INDEX "analysis_ui_message_projection_session_round_idx" ON "platform"."analysis_ui_message_projections" USING btree ("session_id","history_round_id");--> statement-breakpoint
CREATE INDEX "analysis_ui_message_projection_follow_up_idx" ON "platform"."analysis_ui_message_projections" USING btree ("follow_up_id");--> statement-breakpoint
CREATE INDEX "analysis_ui_message_projection_updated_idx" ON "platform"."analysis_ui_message_projections" USING btree ("updated_at");