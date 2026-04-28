-- Story 9.4: 本体变更申请、审批与发布审计
-- 新增 ontology_change_requests, ontology_approval_records, ontology_publish_records 三表

CREATE TABLE IF NOT EXISTS "platform"."ontology_change_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "ontology_version_id" text NOT NULL REFERENCES "platform"."ontology_versions"("id") ON DELETE CASCADE,
  "target_object_type" text NOT NULL,
  "target_object_key" text NOT NULL,
  "change_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "title" text NOT NULL,
  "description" text,
  "before_summary" jsonb,
  "after_summary" jsonb,
  "impact_scope" text[] NOT NULL DEFAULT '{}'::text[],
  "compatibility_type" text NOT NULL,
  "compatibility_note" text,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_change_requests_version_id_idx" ON "platform"."ontology_change_requests" USING btree ("ontology_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_change_requests_status_idx" ON "platform"."ontology_change_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_change_requests_submitted_by_idx" ON "platform"."ontology_change_requests" USING btree ("submitted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_change_requests_target_idx" ON "platform"."ontology_change_requests" USING btree ("target_object_type", "target_object_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform"."ontology_approval_records" (
  "id" text PRIMARY KEY NOT NULL,
  "change_request_id" text NOT NULL REFERENCES "platform"."ontology_change_requests"("id") ON DELETE CASCADE,
  "decision" text NOT NULL,
  "reviewed_by" text NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_approval_records_change_request_id_idx" ON "platform"."ontology_approval_records" USING btree ("change_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_approval_records_reviewed_by_idx" ON "platform"."ontology_approval_records" USING btree ("reviewed_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_approval_records_decision_idx" ON "platform"."ontology_approval_records" USING btree ("decision");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform"."ontology_publish_records" (
  "id" text PRIMARY KEY NOT NULL,
  "ontology_version_id" text NOT NULL REFERENCES "platform"."ontology_versions"("id") ON DELETE CASCADE,
  "published_by" text NOT NULL,
  "previous_version_id" text,
  "change_request_ids" text[] NOT NULL DEFAULT '{}'::text[],
  "publish_note" text,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_publish_records_version_id_idx" ON "platform"."ontology_publish_records" USING btree ("ontology_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_publish_records_published_by_idx" ON "platform"."ontology_publish_records" USING btree ("published_by");
