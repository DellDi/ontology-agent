CREATE TABLE "platform"."audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "session_id" text,
  "event_type" text NOT NULL,
  "event_result" text NOT NULL,
  "event_source" text NOT NULL,
  "correlation_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retention_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_user_id_idx"
  ON "platform"."audit_events" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "audit_events_session_id_idx"
  ON "platform"."audit_events" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "audit_events_event_type_idx"
  ON "platform"."audit_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx"
  ON "platform"."audit_events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_retention_until_idx"
  ON "platform"."audit_events" USING btree ("retention_until");
--> statement-breakpoint
CREATE INDEX "audit_events_correlation_id_idx"
  ON "platform"."audit_events" USING btree ("correlation_id");
