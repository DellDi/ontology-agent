CREATE TABLE "platform"."graph_sync_cursors" (
  "source_name" text PRIMARY KEY NOT NULL,
  "cursor_time" timestamp with time zone,
  "cursor_pk" text,
  "last_run_id" text,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."graph_sync_dirty_scopes" (
  "id" text PRIMARY KEY NOT NULL,
  "scope_type" text NOT NULL,
  "scope_key" text NOT NULL,
  "reason" text NOT NULL,
  "source_name" text NOT NULL,
  "source_pk" text,
  "source_progress" jsonb NOT NULL,
  "first_detected_at" timestamp with time zone NOT NULL,
  "last_detected_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_run_id" text,
  "error_summary" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "graph_sync_dirty_scopes_pending_scope_idx"
  ON "platform"."graph_sync_dirty_scopes" ("scope_type", "scope_key")
  WHERE "status" = 'pending';
