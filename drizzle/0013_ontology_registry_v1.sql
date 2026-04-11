CREATE TABLE "platform"."ontology_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"semver" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"description" text,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_entity_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"synonyms" text[] DEFAULT '{}' NOT NULL,
	"parent_business_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_metric_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"applicable_subject_keys" text[] DEFAULT '{}' NOT NULL,
	"default_aggregation" text,
	"unit" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_factor_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"category" text NOT NULL,
	"related_metric_keys" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_plan_step_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"intent_types" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ontology_versions_status_idx" ON "platform"."ontology_versions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "ontology_versions_published_at_idx" ON "platform"."ontology_versions" USING btree ("published_at");
--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_version_idx" ON "platform"."ontology_entity_definitions" USING btree ("ontology_version_id");
--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_business_key_idx" ON "platform"."ontology_entity_definitions" USING btree ("business_key");
--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_version_key_idx" ON "platform"."ontology_entity_definitions" USING btree ("ontology_version_id","business_key");
--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_status_idx" ON "platform"."ontology_entity_definitions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_version_idx" ON "platform"."ontology_metric_definitions" USING btree ("ontology_version_id");
--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_business_key_idx" ON "platform"."ontology_metric_definitions" USING btree ("business_key");
--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_version_key_idx" ON "platform"."ontology_metric_definitions" USING btree ("ontology_version_id","business_key");
--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_status_idx" ON "platform"."ontology_metric_definitions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_version_idx" ON "platform"."ontology_factor_definitions" USING btree ("ontology_version_id");
--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_business_key_idx" ON "platform"."ontology_factor_definitions" USING btree ("business_key");
--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_version_key_idx" ON "platform"."ontology_factor_definitions" USING btree ("ontology_version_id","business_key");
--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_category_idx" ON "platform"."ontology_factor_definitions" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_status_idx" ON "platform"."ontology_factor_definitions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_version_idx" ON "platform"."ontology_plan_step_templates" USING btree ("ontology_version_id");
--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_business_key_idx" ON "platform"."ontology_plan_step_templates" USING btree ("business_key");
--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_version_key_idx" ON "platform"."ontology_plan_step_templates" USING btree ("ontology_version_id","business_key");
--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_status_idx" ON "platform"."ontology_plan_step_templates" USING btree ("status");
