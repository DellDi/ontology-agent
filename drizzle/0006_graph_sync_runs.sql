CREATE TABLE "platform"."graph_sync_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "mode" text NOT NULL,
  "status" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_key" text NOT NULL,
  "trigger_type" text NOT NULL,
  "triggered_by" text NOT NULL,
  "cursor_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "nodes_written" integer DEFAULT 0 NOT NULL,
  "edges_written" integer DEFAULT 0 NOT NULL,
  "error_summary" text,
  "error_detail" jsonb,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
