CREATE SCHEMA IF NOT EXISTS "ingestion";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."source_definitions" (
    "source_key" text PRIMARY KEY NOT NULL,
    "connector_type" text NOT NULL,
    "connection_ref" text NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "source_definitions_key_check"
        CHECK ("source_key" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "source_definitions_connector_type_check"
        CHECK ("connector_type" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "source_definitions_connection_ref_check"
        CHECK ("connection_ref" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "source_definitions_status_check" CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "source_definitions_time_order_check" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."dataset_definitions" (
    "dataset_key" text PRIMARY KEY NOT NULL,
    "source_key" text NOT NULL,
    "source_namespace" text DEFAULT 'public' NOT NULL,
    "source_relation" text NOT NULL,
    "primary_key_columns" text[] NOT NULL,
    "column_contract" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "cursor_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "delete_policy" text NOT NULL,
    "delete_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "dataset_definitions_source_fk"
        FOREIGN KEY ("source_key") REFERENCES "ingestion"."source_definitions" ("source_key"),
    CONSTRAINT "dataset_definitions_key_check"
        CHECK ("dataset_key" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "dataset_definitions_namespace_check"
        CHECK ("source_namespace" ~ '^[a-z_][a-z0-9_]*$'),
    CONSTRAINT "dataset_definitions_relation_check"
        CHECK ("source_relation" ~ '^[a-z_][a-z0-9_]*$'),
    CONSTRAINT "dataset_definitions_primary_key_check" CHECK (cardinality("primary_key_columns") > 0),
    CONSTRAINT "dataset_definitions_column_contract_type_check"
        CHECK (jsonb_typeof("column_contract") = 'array'),
    CONSTRAINT "dataset_definitions_column_contract_non_empty_check"
        CHECK (jsonb_array_length(
            CASE WHEN jsonb_typeof("column_contract") = 'array'
                 THEN "column_contract" ELSE '[]'::jsonb END) > 0),
    CONSTRAINT "dataset_definitions_cursor_spec_object_check"
        CHECK (jsonb_typeof("cursor_spec") = 'object'),
    CONSTRAINT "dataset_definitions_delete_policy_check"
        CHECK ("delete_policy" IN ('none', 'soft_delete', 'snapshot_diff', 'cdc')),
    CONSTRAINT "dataset_definitions_delete_spec_object_check"
        CHECK (jsonb_typeof("delete_spec") = 'object'),
    CONSTRAINT "dataset_definitions_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "dataset_definitions_status_check" CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "dataset_definitions_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object'),
    CONSTRAINT "dataset_definitions_relation_unique"
        UNIQUE ("source_key", "source_namespace", "source_relation"),
    CONSTRAINT "dataset_definitions_source_dataset_unique"
        UNIQUE ("source_key", "dataset_key"),
    CONSTRAINT "dataset_definitions_time_order_check" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."data_product_definitions" (
    "product_key" text PRIMARY KEY NOT NULL,
    "domain_key" text NOT NULL,
    "canonical_schema" text NOT NULL,
    "canonical_relation" text NOT NULL,
    "transform_ref" text NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "freshness_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "data_product_definitions_key_check"
        CHECK ("product_key" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "data_product_definitions_domain_key_check"
        CHECK ("domain_key" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "data_product_definitions_schema_check"
        CHECK ("canonical_schema" ~ '^[a-z_][a-z0-9_]*$'),
    CONSTRAINT "data_product_definitions_relation_check"
        CHECK ("canonical_relation" ~ '^[a-z_][a-z0-9_]*$'),
    CONSTRAINT "data_product_definitions_transform_ref_check"
        CHECK ("transform_ref" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "data_product_definitions_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "data_product_definitions_freshness_policy_object_check"
        CHECK (jsonb_typeof("freshness_policy") = 'object'),
    CONSTRAINT "data_product_definitions_status_check" CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "data_product_definitions_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object'),
    CONSTRAINT "data_product_definitions_relation_unique"
        UNIQUE ("canonical_schema", "canonical_relation"),
    CONSTRAINT "data_product_definitions_time_order_check" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."data_product_inputs" (
    "product_key" text NOT NULL,
    "input_key" text NOT NULL,
    "dataset_key" text NOT NULL,
    "ordinal" integer NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "mapping_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "data_product_inputs_pk" PRIMARY KEY ("product_key", "input_key"),
    CONSTRAINT "data_product_inputs_product_fk"
        FOREIGN KEY ("product_key") REFERENCES "ingestion"."data_product_definitions" ("product_key"),
    CONSTRAINT "data_product_inputs_dataset_fk"
        FOREIGN KEY ("dataset_key") REFERENCES "ingestion"."dataset_definitions" ("dataset_key"),
    CONSTRAINT "data_product_inputs_key_check"
        CHECK ("input_key" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "data_product_inputs_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "data_product_inputs_mapping_spec_object_check"
        CHECK (jsonb_typeof("mapping_spec") = 'object'),
    CONSTRAINT "data_product_inputs_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object'),
    CONSTRAINT "data_product_inputs_product_ordinal_unique" UNIQUE ("product_key", "ordinal"),
    CONSTRAINT "data_product_inputs_product_input_dataset_unique"
        UNIQUE ("product_key", "input_key", "dataset_key"),
    CONSTRAINT "data_product_inputs_time_order_check" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint

-- One source-level run captures one source snapshot and may publish versions for many datasets.
CREATE TABLE IF NOT EXISTS "ingestion"."source_ingestion_runs" (
    "id" text PRIMARY KEY NOT NULL,
    "source_key" text NOT NULL,
    "mode" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "trigger_type" text NOT NULL,
    "triggered_by" text,
    "correlation_id" text,
    "snapshot_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "row_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "error_code" text,
    "error_detail" jsonb,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "source_ingestion_runs_source_fk"
        FOREIGN KEY ("source_key") REFERENCES "ingestion"."source_definitions" ("source_key"),
    CONSTRAINT "source_ingestion_runs_source_id_unique" UNIQUE ("source_key", "id"),
    CONSTRAINT "source_ingestion_runs_key_check" CHECK (btrim("id") <> ''),
    CONSTRAINT "source_ingestion_runs_mode_check"
        CHECK ("mode" IN ('full', 'incremental', 'reconcile')),
    CONSTRAINT "source_ingestion_runs_status_check"
        CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT "source_ingestion_runs_trigger_type_check"
        CHECK ("trigger_type" IN ('manual', 'scheduled', 'bootstrap', 'retry')),
    CONSTRAINT "source_ingestion_runs_snapshot_context_object_check"
        CHECK (jsonb_typeof("snapshot_context") = 'object'),
    CONSTRAINT "source_ingestion_runs_row_counts_object_check"
        CHECK (jsonb_typeof("row_counts") = 'object'),
    CONSTRAINT "source_ingestion_runs_error_detail_object_check"
        CHECK ("error_detail" IS NULL OR jsonb_typeof("error_detail") = 'object'),
    CONSTRAINT "source_ingestion_runs_error_code_check"
        CHECK ("error_code" IS NULL OR btrim("error_code") <> ''),
    CONSTRAINT "source_ingestion_runs_triggered_by_check"
        CHECK ("triggered_by" IS NULL OR btrim("triggered_by") <> ''),
    CONSTRAINT "source_ingestion_runs_correlation_id_check"
        CHECK ("correlation_id" IS NULL OR btrim("correlation_id") <> ''),
    CONSTRAINT "source_ingestion_runs_terminal_time_check"
        CHECK (("status" IN ('completed', 'failed', 'cancelled')) = ("finished_at" IS NOT NULL)),
    CONSTRAINT "source_ingestion_runs_running_time_check"
        CHECK ("status" <> 'running' OR "started_at" IS NOT NULL),
    CONSTRAINT "source_ingestion_runs_time_order_check"
        CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at"),
    CONSTRAINT "source_ingestion_runs_updated_time_check" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint

-- A source snapshot can contain several governed datasets.
CREATE TABLE IF NOT EXISTS "ingestion"."source_dataset_versions" (
    "id" text PRIMARY KEY NOT NULL,
    "source_key" text NOT NULL,
    "dataset_key" text NOT NULL,
    "source_ingestion_run_id" text NOT NULL,
    "version_number" bigint NOT NULL,
    "storage_ref" text,
    "source_watermark" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "committed_cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "row_count" bigint DEFAULT 0 NOT NULL,
    "content_hash" text,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "status" text DEFAULT 'building' NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "source_dataset_versions_dataset_fk"
        FOREIGN KEY ("source_key", "dataset_key")
            REFERENCES "ingestion"."dataset_definitions" ("source_key", "dataset_key"),
    CONSTRAINT "source_dataset_versions_run_fk"
        FOREIGN KEY ("source_key", "source_ingestion_run_id")
            REFERENCES "ingestion"."source_ingestion_runs" ("source_key", "id"),
    CONSTRAINT "source_dataset_versions_run_dataset_unique"
        UNIQUE ("source_ingestion_run_id", "dataset_key"),
    CONSTRAINT "source_dataset_versions_dataset_version_unique"
        UNIQUE ("dataset_key", "version_number"),
    CONSTRAINT "source_dataset_versions_dataset_id_unique" UNIQUE ("dataset_key", "id"),
    CONSTRAINT "source_dataset_versions_key_check" CHECK (btrim("id") <> ''),
    CONSTRAINT "source_dataset_versions_version_number_check" CHECK ("version_number" > 0),
    CONSTRAINT "source_dataset_versions_source_watermark_object_check"
        CHECK (jsonb_typeof("source_watermark") = 'object'),
    CONSTRAINT "source_dataset_versions_committed_cursor_object_check"
        CHECK (jsonb_typeof("committed_cursor") = 'object'),
    CONSTRAINT "source_dataset_versions_row_count_check" CHECK ("row_count" >= 0),
    CONSTRAINT "source_dataset_versions_content_hash_check"
        CHECK ("content_hash" IS NULL OR btrim("content_hash") <> ''),
    CONSTRAINT "source_dataset_versions_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "source_dataset_versions_status_check"
        CHECK ("status" IN ('building', 'published', 'failed', 'revoked')),
    CONSTRAINT "source_dataset_versions_storage_ref_check"
        CHECK ("storage_ref" IS NULL OR btrim("storage_ref") <> ''),
    CONSTRAINT "source_dataset_versions_published_check"
        CHECK ("status" NOT IN ('published', 'revoked')
               OR ("published_at" IS NOT NULL
                   AND "storage_ref" IS NOT NULL
                   AND "content_hash" IS NOT NULL
                   AND "source_watermark" <> '{}'::jsonb)),
    CONSTRAINT "source_dataset_versions_created_published_time_check"
        CHECK ("published_at" IS NULL OR "published_at" >= "created_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."dataset_cursors" (
    "dataset_key" text PRIMARY KEY NOT NULL,
    "committed_cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "last_successful_version_id" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "dataset_cursors_dataset_fk"
        FOREIGN KEY ("dataset_key") REFERENCES "ingestion"."dataset_definitions" ("dataset_key"),
    CONSTRAINT "dataset_cursors_last_version_fk"
        FOREIGN KEY ("dataset_key", "last_successful_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "dataset_cursors_key_check" CHECK (btrim("dataset_key") <> ''),
    CONSTRAINT "dataset_cursors_cursor_object_check"
        CHECK (jsonb_typeof("committed_cursor") = 'object')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."product_materialization_runs" (
    "id" text PRIMARY KEY NOT NULL,
    "product_key" text NOT NULL,
    "mode" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "trigger_type" text NOT NULL,
    "triggered_by" text,
    "correlation_id" text,
    "input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "row_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "error_code" text,
    "error_detail" jsonb,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "product_materialization_runs_product_fk"
        FOREIGN KEY ("product_key") REFERENCES "ingestion"."data_product_definitions" ("product_key"),
    CONSTRAINT "product_materialization_runs_product_id_unique" UNIQUE ("product_key", "id"),
    CONSTRAINT "product_materialization_runs_key_check" CHECK (btrim("id") <> ''),
    CONSTRAINT "product_materialization_runs_mode_check"
        CHECK ("mode" IN ('full', 'incremental', 'reconcile')),
    CONSTRAINT "product_materialization_runs_status_check"
        CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT "product_materialization_runs_trigger_type_check"
        CHECK ("trigger_type" IN ('manual', 'scheduled', 'bootstrap', 'retry')),
    CONSTRAINT "product_materialization_runs_input_summary_object_check"
        CHECK (jsonb_typeof("input_summary") = 'object'),
    CONSTRAINT "product_materialization_runs_row_counts_object_check"
        CHECK (jsonb_typeof("row_counts") = 'object'),
    CONSTRAINT "product_materialization_runs_error_detail_object_check"
        CHECK ("error_detail" IS NULL OR jsonb_typeof("error_detail") = 'object'),
    CONSTRAINT "product_materialization_runs_error_code_check"
        CHECK ("error_code" IS NULL OR btrim("error_code") <> ''),
    CONSTRAINT "product_materialization_runs_triggered_by_check"
        CHECK ("triggered_by" IS NULL OR btrim("triggered_by") <> ''),
    CONSTRAINT "product_materialization_runs_correlation_id_check"
        CHECK ("correlation_id" IS NULL OR btrim("correlation_id") <> ''),
    CONSTRAINT "product_materialization_runs_terminal_time_check"
        CHECK (("status" IN ('completed', 'failed', 'cancelled')) = ("finished_at" IS NOT NULL)),
    CONSTRAINT "product_materialization_runs_running_time_check"
        CHECK ("status" <> 'running' OR "started_at" IS NOT NULL),
    CONSTRAINT "product_materialization_runs_time_order_check"
        CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at"),
    CONSTRAINT "product_materialization_runs_updated_time_check" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."data_product_versions" (
    "id" text PRIMARY KEY NOT NULL,
    "product_key" text NOT NULL,
    "materialization_run_id" text NOT NULL,
    "version_number" bigint NOT NULL,
    "storage_ref" text,
    "row_count" bigint DEFAULT 0 NOT NULL,
    "content_hash" text,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "status" text DEFAULT 'building' NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "data_product_versions_product_fk"
        FOREIGN KEY ("product_key") REFERENCES "ingestion"."data_product_definitions" ("product_key"),
    CONSTRAINT "data_product_versions_run_fk"
        FOREIGN KEY ("product_key", "materialization_run_id")
            REFERENCES "ingestion"."product_materialization_runs" ("product_key", "id"),
    CONSTRAINT "data_product_versions_materialization_run_unique" UNIQUE ("materialization_run_id"),
    CONSTRAINT "data_product_versions_product_id_unique" UNIQUE ("product_key", "id"),
    CONSTRAINT "data_product_versions_product_version_unique"
        UNIQUE ("product_key", "version_number"),
    CONSTRAINT "data_product_versions_key_check" CHECK (btrim("id") <> ''),
    CONSTRAINT "data_product_versions_version_number_check" CHECK ("version_number" > 0),
    CONSTRAINT "data_product_versions_row_count_check" CHECK ("row_count" >= 0),
    CONSTRAINT "data_product_versions_content_hash_check"
        CHECK ("content_hash" IS NULL OR btrim("content_hash") <> ''),
    CONSTRAINT "data_product_versions_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "data_product_versions_status_check"
        CHECK ("status" IN ('building', 'published', 'failed', 'revoked')),
    CONSTRAINT "data_product_versions_storage_ref_check"
        CHECK ("storage_ref" IS NULL OR btrim("storage_ref") <> ''),
    CONSTRAINT "data_product_versions_published_check"
        CHECK ("status" NOT IN ('published', 'revoked')
               OR ("published_at" IS NOT NULL
                   AND "storage_ref" IS NOT NULL
                   AND "content_hash" IS NOT NULL)),
    CONSTRAINT "data_product_versions_created_published_time_check"
        CHECK ("published_at" IS NULL OR "published_at" >= "created_at")
);
--> statement-breakpoint

-- One lineage row binds one product input to one immutable source dataset version.
CREATE TABLE IF NOT EXISTS "ingestion"."data_product_version_lineage" (
    "id" text PRIMARY KEY NOT NULL,
    "product_key" text NOT NULL,
    "product_version_id" text NOT NULL,
    "input_key" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "transform_ref" text NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "data_product_version_lineage_target_fk"
        FOREIGN KEY ("product_key", "product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("product_key", "id"),
    CONSTRAINT "data_product_version_lineage_input_fk"
        FOREIGN KEY ("product_key", "input_key", "source_dataset_key")
            REFERENCES "ingestion"."data_product_inputs" ("product_key", "input_key", "dataset_key"),
    CONSTRAINT "data_product_version_lineage_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "data_product_version_lineage_target_input_unique"
        UNIQUE ("product_key", "product_version_id", "input_key"),
    CONSTRAINT "data_product_version_lineage_key_check" CHECK (btrim("id") <> ''),
    CONSTRAINT "data_product_version_lineage_input_key_check"
        CHECK ("input_key" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "data_product_version_lineage_transform_ref_check"
        CHECK ("transform_ref" ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT "data_product_version_lineage_metadata_object_check"
        CHECK (jsonb_typeof("metadata") = 'object')
);
--> statement-breakpoint

-- A frozen set pins several product versions for one execution/replay boundary.
CREATE TABLE IF NOT EXISTS "ingestion"."dataset_version_sets" (
    "set_id" text PRIMARY KEY NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
    "frozen_at" timestamp with time zone,
    "created_by" text DEFAULT 'system' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "dataset_version_sets_key_check" CHECK (btrim("set_id") <> ''),
    CONSTRAINT "dataset_version_sets_status_check"
        CHECK ("status" IN ('draft', 'frozen', 'revoked')),
    CONSTRAINT "dataset_version_sets_created_by_check" CHECK (btrim("created_by") <> ''),
    CONSTRAINT "dataset_version_sets_frozen_time_check"
        CHECK ("status" = 'draft' OR "frozen_at" IS NOT NULL),
    CONSTRAINT "dataset_version_sets_time_order_check"
        CHECK ("frozen_at" IS NULL OR "frozen_at" >= "captured_at"),
    CONSTRAINT "dataset_version_sets_created_captured_time_check"
        CHECK ("captured_at" >= "created_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion"."dataset_version_set_items" (
    "set_id" text NOT NULL,
    "product_key" text NOT NULL,
    "product_version_id" text NOT NULL,
    CONSTRAINT "dataset_version_set_items_pk" PRIMARY KEY ("set_id", "product_key"),
    CONSTRAINT "dataset_version_set_items_set_fk"
        FOREIGN KEY ("set_id") REFERENCES "ingestion"."dataset_version_sets" ("set_id"),
    CONSTRAINT "dataset_version_set_items_product_version_fk"
        FOREIGN KEY ("product_key", "product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("product_key", "id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "source_definitions_status_idx"
    ON "ingestion"."source_definitions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataset_definitions_source_status_idx"
    ON "ingestion"."dataset_definitions" USING btree ("source_key", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_product_definitions_domain_status_idx"
    ON "ingestion"."data_product_definitions" USING btree ("domain_key", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_product_inputs_dataset_idx"
    ON "ingestion"."data_product_inputs" USING btree ("dataset_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_ingestion_runs_source_status_created_idx"
    ON "ingestion"."source_ingestion_runs" USING btree ("source_key", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_ingestion_runs_correlation_idx"
    ON "ingestion"."source_ingestion_runs" USING btree ("correlation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_dataset_versions_dataset_status_published_idx"
    ON "ingestion"."source_dataset_versions" USING btree ("dataset_key", "status", "published_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_materialization_runs_product_status_created_idx"
    ON "ingestion"."product_materialization_runs" USING btree ("product_key", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_materialization_runs_correlation_idx"
    ON "ingestion"."product_materialization_runs" USING btree ("correlation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_product_versions_product_status_published_idx"
    ON "ingestion"."data_product_versions" USING btree ("product_key", "status", "published_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_product_version_lineage_source_version_idx"
    ON "ingestion"."data_product_version_lineage"
    USING btree ("source_dataset_key", "source_dataset_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_product_version_lineage_target_version_idx"
    ON "ingestion"."data_product_version_lineage"
    USING btree ("product_key", "product_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataset_version_set_items_product_version_idx"
    ON "ingestion"."dataset_version_set_items"
    USING btree ("product_key", "product_version_id");
--> statement-breakpoint

-- Published artifacts are immutable. The only allowed state transition is
-- published -> revoked without changing the frozen artifact metadata.
CREATE OR REPLACE FUNCTION "ingestion"."guard_published_artifact_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status IN ('published', 'revoked') THEN
        IF TG_OP = 'UPDATE'
           AND OLD.status = 'published'
           AND NEW.status = 'revoked'
           AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published ingestion artifact is immutable: %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ingestion"."guard_immutable_row_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'frozen ingestion row is immutable: %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'source_dataset_versions_immutable_trg'
                   AND tgrelid = 'ingestion.source_dataset_versions'::regclass) THEN
        CREATE TRIGGER source_dataset_versions_immutable_trg
        BEFORE UPDATE OR DELETE ON ingestion.source_dataset_versions
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_published_artifact_mutation();
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'data_product_versions_immutable_trg'
                   AND tgrelid = 'ingestion.data_product_versions'::regclass) THEN
        CREATE TRIGGER data_product_versions_immutable_trg
        BEFORE UPDATE OR DELETE ON ingestion.data_product_versions
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_published_artifact_mutation();
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'data_product_version_lineage_immutable_trg'
                   AND tgrelid = 'ingestion.data_product_version_lineage'::regclass) THEN
        CREATE TRIGGER data_product_version_lineage_immutable_trg
        BEFORE UPDATE OR DELETE ON ingestion.data_product_version_lineage
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'dataset_version_set_items_immutable_trg'
                   AND tgrelid = 'ingestion.dataset_version_set_items'::regclass) THEN
        CREATE TRIGGER dataset_version_set_items_immutable_trg
        BEFORE UPDATE OR DELETE ON ingestion.dataset_version_set_items
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
END;
$$;
--> statement-breakpoint
