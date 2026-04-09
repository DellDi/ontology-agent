CREATE TABLE "platform"."analysis_session_follow_ups" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "question_text" text NOT NULL,
  "referenced_execution_id" text NOT NULL,
  "referenced_conclusion_title" text,
  "referenced_conclusion_summary" text,
  "inherited_context" jsonb NOT NULL,
  "merged_context" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_session_idx"
  ON "platform"."analysis_session_follow_ups" ("session_id");
--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_owner_session_idx"
  ON "platform"."analysis_session_follow_ups" ("owner_user_id", "session_id");
--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_execution_idx"
  ON "platform"."analysis_session_follow_ups" ("referenced_execution_id");
--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_created_at_idx"
  ON "platform"."analysis_session_follow_ups" ("created_at");
