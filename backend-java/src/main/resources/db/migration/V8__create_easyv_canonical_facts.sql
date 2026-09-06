-- P3 EasyV Domain Data Pack.
--
-- The source catalog below contains only reviewed relation/column contracts.
-- Credentials never belong in this migration; connection_ref is resolved by
-- the runtime from the deployment environment.

CREATE SCHEMA IF NOT EXISTS "facts";
--> statement-breakpoint

-- A canonical row may be inserted only while its product version is being
-- built and while the referenced source artifact is already published.  The
-- materializer inserts rows and publishes the product version in one target
-- transaction, so a published version cannot be extended afterwards.
CREATE OR REPLACE FUNCTION "ingestion"."guard_canonical_fact_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    product_status text;
    source_status text;
BEGIN
    SELECT status INTO STRICT product_status
    FROM ingestion.data_product_versions
    WHERE id = NEW.product_version_id
    FOR SHARE;
    IF product_status <> 'building' THEN
        RAISE EXCEPTION 'canonical fact requires BUILDING product version: %', NEW.product_version_id
            USING ERRCODE = '55000';
    END IF;

    SELECT status INTO STRICT source_status
    FROM ingestion.source_dataset_versions
    WHERE dataset_key = NEW.source_dataset_key
      AND id = NEW.source_dataset_version_id
    FOR SHARE;
    IF source_status <> 'published' THEN
        RAISE EXCEPTION 'canonical fact requires PUBLISHED source dataset version: %',
            NEW.source_dataset_version_id USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_ai_application" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "app_id" text NOT NULL,
    "generation_task_id" text,
    "user_id" bigint NOT NULL,
    "space_id" bigint NOT NULL,
    "team_id" bigint NOT NULL,
    "scope_type" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "is_deleted" boolean NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_ai_application_pk" PRIMARY KEY ("product_version_id", "source_id"),
    CONSTRAINT "easyv_ai_application_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_ai_application_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_ai_application_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-ai-application'),
    CONSTRAINT "easyv_ai_application_app_id_unique"
        UNIQUE ("product_version_id", "app_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_prototype_task" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "app_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_prototype_task_pk" PRIMARY KEY ("product_version_id", "source_id"),
    CONSTRAINT "easyv_prototype_task_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_prototype_task_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_prototype_task_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-prototype-task'),
    CONSTRAINT "easyv_prototype_task_app_id_unique"
        UNIQUE ("product_version_id", "app_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_pipeline_node" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "task_id" text NOT NULL,
    "step_name" text NOT NULL,
    "branch" text NOT NULL,
    "status" text NOT NULL,
    "duration_ms" bigint,
    "created_at" timestamp with time zone NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_pipeline_node_pk" PRIMARY KEY ("product_version_id", "source_id"),
    CONSTRAINT "easyv_pipeline_node_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_pipeline_node_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_pipeline_node_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-pipeline-node'),
    CONSTRAINT "easyv_pipeline_node_duration_check"
        CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_forge_generation_task" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" uuid NOT NULL,
    "task_id" text NOT NULL,
    "app_id" text NOT NULL,
    "status" text NOT NULL,
    "failure_reason_hash" text NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_forge_generation_task_pk" PRIMARY KEY ("product_version_id", "source_id"),
    CONSTRAINT "easyv_forge_generation_task_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_forge_generation_task_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_forge_generation_task_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-forge-task'),
    CONSTRAINT "easyv_forge_generation_task_id_unique"
        UNIQUE ("product_version_id", "task_id"),
    CONSTRAINT "easyv_forge_generation_task_failure_hash_check"
        CHECK ("failure_reason_hash" ~ '^[0-9a-f]{32}$'),
    CONSTRAINT "easyv_forge_generation_task_time_order_check"
        CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_generation_feedback" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "space_id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "operated_at" timestamp with time zone NOT NULL,
    "ai_action_type" text NOT NULL,
    "execute_result" smallint NOT NULL,
    "rating" smallint,
    "app_id" text,
    "task_id" text,
    "is_save_as_edit" boolean,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_generation_feedback_pk" PRIMARY KEY ("product_version_id", "source_id"),
    CONSTRAINT "easyv_generation_feedback_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_generation_feedback_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_generation_feedback_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-generation-feedback')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "easyv_ai_application_scope_idx"
    ON "facts"."easyv_ai_application" ("product_version_id", "user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_prototype_task_app_idx"
    ON "facts"."easyv_prototype_task" ("product_version_id", "app_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_pipeline_node_task_idx"
    ON "facts"."easyv_pipeline_node" ("product_version_id", "task_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_forge_generation_task_app_idx"
    ON "facts"."easyv_forge_generation_task" ("product_version_id", "app_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_generation_feedback_scope_idx"
    ON "facts"."easyv_generation_feedback" ("product_version_id", "user_id", "operated_at");
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_ai_application_building_insert_trg'
                   AND tgrelid = 'facts.easyv_ai_application'::regclass) THEN
        CREATE TRIGGER easyv_ai_application_building_insert_trg
        BEFORE INSERT ON facts.easyv_ai_application
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_prototype_task_building_insert_trg'
                   AND tgrelid = 'facts.easyv_prototype_task'::regclass) THEN
        CREATE TRIGGER easyv_prototype_task_building_insert_trg
        BEFORE INSERT ON facts.easyv_prototype_task
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_pipeline_node_building_insert_trg'
                   AND tgrelid = 'facts.easyv_pipeline_node'::regclass) THEN
        CREATE TRIGGER easyv_pipeline_node_building_insert_trg
        BEFORE INSERT ON facts.easyv_pipeline_node
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_forge_generation_task_building_insert_trg'
                   AND tgrelid = 'facts.easyv_forge_generation_task'::regclass) THEN
        CREATE TRIGGER easyv_forge_generation_task_building_insert_trg
        BEFORE INSERT ON facts.easyv_forge_generation_task
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_generation_feedback_building_insert_trg'
                   AND tgrelid = 'facts.easyv_generation_feedback'::regclass) THEN
        CREATE TRIGGER easyv_generation_feedback_building_insert_trg
        BEFORE INSERT ON facts.easyv_generation_feedback
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_ai_application_immutable_trg'
                   AND tgrelid = 'facts.easyv_ai_application'::regclass) THEN
        CREATE TRIGGER easyv_ai_application_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.easyv_ai_application
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_prototype_task_immutable_trg'
                   AND tgrelid = 'facts.easyv_prototype_task'::regclass) THEN
        CREATE TRIGGER easyv_prototype_task_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.easyv_prototype_task
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_pipeline_node_immutable_trg'
                   AND tgrelid = 'facts.easyv_pipeline_node'::regclass) THEN
        CREATE TRIGGER easyv_pipeline_node_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.easyv_pipeline_node
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_forge_generation_task_immutable_trg'
                   AND tgrelid = 'facts.easyv_forge_generation_task'::regclass) THEN
        CREATE TRIGGER easyv_forge_generation_task_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.easyv_forge_generation_task
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'easyv_generation_feedback_immutable_trg'
                   AND tgrelid = 'facts.easyv_generation_feedback'::regclass) THEN
        CREATE TRIGGER easyv_generation_feedback_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.easyv_generation_feedback
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
END;
$$;
--> statement-breakpoint

-- One source definition is shared by the five dataset contracts.  The
-- connection_ref is deliberately only a server-side resolver name.
INSERT INTO "ingestion"."source_definitions"
    ("source_key", "connector_type", "connection_ref", "status")
VALUES ('easyv', 'postgres', 'easyv-source', 'active')
ON CONFLICT ("source_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."dataset_definitions"
    ("dataset_key", "source_key", "source_namespace", "source_relation",
     "primary_key_columns", "column_contract", "cursor_spec", "delete_policy",
     "delete_spec", "schema_version", "status", "metadata")
VALUES
('easyv-ai-application', 'easyv', 'easyv_saas', 'ai_screen_app',
 ARRAY['id'],
 '[
    {"name":"id","type":"LONG","nullable":false},
    {"name":"app_id","type":"STRING","nullable":false},
    {"name":"generation_task_id","type":"STRING","nullable":true},
    {"name":"user_id","type":"LONG","nullable":false},
    {"name":"space_id","type":"LONG","nullable":false},
    {"name":"team_id","type":"LONG","nullable":false},
    {"name":"scope_type","type":"STRING","nullable":false},
    {"name":"create_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"create_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"update_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"update_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"is_delete","type":"STRING","nullable":true}
 ]'::jsonb,
 '{"strategy":"WATERMARK","watermarkColumn":"update_time","tieBreakerColumn":"id"}'::jsonb,
 'soft_delete', '{"column":"is_delete","deletedValues":["1"]}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","deletion":"tombstone","sensitiveColumnsExcluded":["template_name","app_name","extra_config","app_layout"]}'::jsonb),
('easyv-prototype-task', 'easyv', 'easyv_saas', 'ai_screen_prototype',
 ARRAY['id'],
 '[
    {"name":"id","type":"LONG","nullable":false},
    {"name":"app_id","type":"STRING","nullable":false},
    {"name":"create_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"create_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"update_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"update_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}}
 ]'::jsonb,
 '{"strategy":"WATERMARK","watermarkColumn":"update_time","tieBreakerColumn":"id"}'::jsonb,
 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sensitiveColumnsExcluded":["screen_structure_xml","screen_template_json","screen_app_json","block_ids","warnings","screen_prototype_json"]}'::jsonb),
('easyv-pipeline-node', 'easyv', 'easyv_saas', 'ai_pipeline_node_record',
 ARRAY['id'],
 '[
    {"name":"id","type":"LONG","nullable":false},
    {"name":"task_id","type":"STRING","nullable":false},
    {"name":"step_name","type":"STRING","nullable":false},
    {"name":"branch","type":"STRING","nullable":false},
    {"name":"status","type":"STRING","nullable":false},
    {"name":"duration_ms","type":"LONG","nullable":true},
    {"name":"create_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"create_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,
 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sensitiveColumnsExcluded":["session_id","role","output","show_message","intent"]}'::jsonb),
('easyv-forge-task', 'easyv', 'easyv_saas', 'generation_tasks',
 ARRAY['id'],
 '[
    {"name":"id","type":"UUID","nullable":false},
    {"name":"task_id","type":"STRING","nullable":false},
    {"name":"app_id","type":"STRING","nullable":false},
    {"name":"status","type":"STRING","nullable":false},
    {"name":"failure_reason","type":"JSON","nullable":true},
    {"name":"started_at","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":true,
      "timeSemantics":{"column":"started_at","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"finished_at","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":true,
      "timeSemantics":{"column":"finished_at","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"create_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"create_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"update_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"update_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}}
 ]'::jsonb,
 '{"strategy":"WATERMARK","watermarkColumn":"update_time","tieBreakerColumn":"id"}'::jsonb,
 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sensitiveHandling":{"failure_reason":"md5_only"},"sensitiveColumnsExcluded":["pages_progress","bull_job_id","stream_key","failure_reason_raw"]}'::jsonb),
('easyv-generation-feedback', 'easyv', 'easyv_saas', 'dt_ai_operation_log',
 ARRAY['id'],
 '[
    {"name":"id","type":"LONG","nullable":false},
    {"name":"space_id","type":"LONG","nullable":false},
    {"name":"user_id","type":"LONG","nullable":false},
    {"name":"operate_time","type":"TIMESTAMPTZ","nullable":false,
      "timeSemantics":{"column":"operate_time","kind":"TIMESTAMPTZ"}},
    {"name":"ai_action_type","type":"STRING","nullable":false},
    {"name":"execute_result","type":"INTEGER","nullable":false},
    {"name":"rating","type":"INTEGER","nullable":true},
    {"name":"app_id","type":"STRING","nullable":true},
    {"name":"task_id","type":"STRING","nullable":true},
    {"name":"is_save_as_edit","type":"BOOLEAN","nullable":true}
 ]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,
 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sensitiveColumnsExcluded":["user_input","fail_reason","description","remark","metadata"]}'::jsonb)
ON CONFLICT ("dataset_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."data_product_definitions"
    ("product_key", "domain_key", "canonical_schema", "canonical_relation",
     "transform_ref", "schema_version", "freshness_policy", "status", "metadata")
VALUES
('easyv-ai-application', 'easyv', 'facts', 'easyv_ai_application', 'easyv-ai-application-v1', 1,
 '{"mode":"watermark","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-ai-application","primaryKey":["product_version_id","source_id"]}'::jsonb),
('easyv-prototype-task', 'easyv', 'facts', 'easyv_prototype_task', 'easyv-prototype-task-v1', 1,
 '{"mode":"watermark+snapshot_diff","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-prototype-task","primaryKey":["product_version_id","source_id"]}'::jsonb),
('easyv-pipeline-node', 'easyv', 'facts', 'easyv_pipeline_node', 'easyv-pipeline-node-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-pipeline-node","primaryKey":["product_version_id","source_id"]}'::jsonb),
('easyv-forge-task', 'easyv', 'facts', 'easyv_forge_generation_task', 'easyv-forge-task-v1', 1,
 '{"mode":"watermark+snapshot_diff","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-forge-task","primaryKey":["product_version_id","source_id"],"failureReason":"md5_only"}'::jsonb),
('easyv-generation-feedback', 'easyv', 'facts', 'easyv_generation_feedback', 'easyv-generation-feedback-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-generation-feedback","primaryKey":["product_version_id","source_id"]}'::jsonb)
ON CONFLICT ("product_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."data_product_inputs"
    ("product_key", "input_key", "dataset_key", "ordinal", "is_required", "mapping_spec", "metadata")
VALUES
('easyv-ai-application', 'source', 'easyv-ai-application', 0, true,
 '{"id":"source_id","app_id":"app_id","generation_task_id":"generation_task_id","user_id":"user_id","space_id":"space_id","team_id":"team_id","scope_type":"scope_type","create_time":"created_at","update_time":"updated_at","is_delete":"is_deleted"}'::jsonb, '{}'::jsonb),
('easyv-prototype-task', 'source', 'easyv-prototype-task', 0, true,
 '{"id":"source_id","app_id":"app_id","create_time":"created_at","update_time":"updated_at"}'::jsonb, '{}'::jsonb),
('easyv-pipeline-node', 'source', 'easyv-pipeline-node', 0, true,
 '{"id":"source_id","task_id":"task_id","step_name":"step_name","branch":"branch","status":"status","duration_ms":"duration_ms","create_time":"created_at"}'::jsonb, '{}'::jsonb),
('easyv-forge-task', 'source', 'easyv-forge-task', 0, true,
 '{"id":"source_id","task_id":"task_id","app_id":"app_id","status":"status","failure_reason":"failure_reason_hash:md5","started_at":"started_at","finished_at":"finished_at","create_time":"created_at","update_time":"updated_at"}'::jsonb, '{"rawFailureReason":"never stored in facts"}'::jsonb),
('easyv-generation-feedback', 'source', 'easyv-generation-feedback', 0, true,
 '{"id":"source_id","space_id":"space_id","user_id":"user_id","operate_time":"operated_at","ai_action_type":"ai_action_type","execute_result":"execute_result","rating":"rating","app_id":"app_id","task_id":"task_id","is_save_as_edit":"is_save_as_edit"}'::jsonb, '{}'::jsonb)
ON CONFLICT ("product_key", "input_key") DO NOTHING;
