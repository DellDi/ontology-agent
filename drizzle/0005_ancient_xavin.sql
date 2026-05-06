ALTER TABLE "platform"."analysis_execution_snapshots" ADD COLUMN "ontology_version_id" text;--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups" ADD COLUMN "ontology_version_id" text;--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups" ADD COLUMN "ontology_version_binding_source" text DEFAULT 'legacy/unknown' NOT NULL;--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_ontology_version_idx" ON "platform"."analysis_execution_snapshots" USING btree ("ontology_version_id");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_ontology_version_idx" ON "platform"."analysis_session_follow_ups" USING btree ("ontology_version_id");