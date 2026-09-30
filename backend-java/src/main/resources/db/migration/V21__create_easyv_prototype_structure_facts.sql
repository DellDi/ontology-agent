-- EasyV 原型结构事实：版式（每个原型一行）、区域（Block）、图表组件。
--
-- 三个数据产品与既有 easyv-prototype-task 产品共用同一个源数据集 easyv-prototype-task
-- （一张源表只能有一个数据集定义）。该数据集列契约扩展为 schema_version 2，新增布局 XML 与原型 JSON；
-- 已发布的 v1 源版本保持不变，扩展后的首次 ingestion 必须是 FULL/RECONCILE（v1 增量链不能与 v2 契约混用，
-- 物化时会 fail loud）。facts 只保存结构化字段：标识、类别、几何、计数与结构签名；标题、描述、指标名称等
-- 自由文本由解析器丢弃，不进入 facts。无法解析的原型仍保留一行版式记录（parse_status 非 ok，
-- 附可定位的错误码），不生成区域与组件，也不被静默丢弃。

CREATE TABLE IF NOT EXISTS "facts"."easyv_prototype_layout" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "app_id" text NOT NULL,
    "parse_status" text NOT NULL,
    "parse_error_code" text,
    "parse_error_detail" text,
    "layout_type" text,
    "block_count" integer,
    "component_count" integer,
    "layout_signature" text,
    "scheme_signature" text,
    "count_signature" text,
    "chart_signature" text,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_prototype_layout_pk" PRIMARY KEY ("product_version_id", "source_id"),
    CONSTRAINT "easyv_prototype_layout_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_prototype_layout_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_prototype_layout_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-prototype-task'),
    CONSTRAINT "easyv_prototype_layout_app_id_unique"
        UNIQUE ("product_version_id", "app_id"),
    CONSTRAINT "easyv_prototype_layout_status_check"
        CHECK ("parse_status" IN ('ok', 'invalid_xml', 'invalid_json', 'inconsistent')),
    CONSTRAINT "easyv_prototype_layout_result_check"
        CHECK (
            ("parse_status" = 'ok'
                AND "parse_error_code" IS NULL AND "parse_error_detail" IS NULL
                AND "block_count" IS NOT NULL AND "component_count" IS NOT NULL
                AND "layout_signature" IS NOT NULL AND "scheme_signature" IS NOT NULL
                AND "count_signature" IS NOT NULL AND "chart_signature" IS NOT NULL
                AND "layout_signature" ~ '^[0-9a-f]{64}$' AND "scheme_signature" ~ '^[0-9a-f]{64}$'
                AND "count_signature" ~ '^[0-9a-f]{64}$' AND "chart_signature" ~ '^[0-9a-f]{64}$')
            OR ("parse_status" <> 'ok'
                AND "parse_error_code" IS NOT NULL
                AND "block_count" IS NULL AND "component_count" IS NULL
                AND "layout_signature" IS NULL AND "scheme_signature" IS NULL
                AND "count_signature" IS NULL AND "chart_signature" IS NULL)
        ),
    CONSTRAINT "easyv_prototype_layout_count_check"
        CHECK ("block_count" IS NULL OR ("block_count" >= 0 AND "component_count" >= 0))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_prototype_block" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "app_id" text NOT NULL,
    "block_id" text NOT NULL,
    "container_tag" text,
    "container_id" text,
    "grid_direction" text,
    "block_type_id" text,
    "block_size" text,
    "span" text,
    "weight" integer,
    "scheme_id" text,
    "component_count" integer NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_prototype_block_pk" PRIMARY KEY ("product_version_id", "source_id", "block_id"),
    CONSTRAINT "easyv_prototype_block_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_prototype_block_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_prototype_block_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-prototype-task'),
    CONSTRAINT "easyv_prototype_block_component_count_check"
        CHECK ("component_count" >= 0)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."easyv_prototype_component" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "source_id" bigint NOT NULL,
    "app_id" text NOT NULL,
    "block_id" text NOT NULL,
    "component_id" text NOT NULL,
    "chart_family" text NOT NULL,
    "library_component_id" text,
    "scene_type" text,
    "source_type" text,
    "grid_col" integer,
    "grid_row" integer,
    "grid_col_span" integer,
    "grid_row_span" integer,
    "created_at" timestamp with time zone NOT NULL,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "easyv_prototype_component_pk" PRIMARY KEY ("product_version_id", "source_id", "component_id"),
    CONSTRAINT "easyv_prototype_component_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "easyv_prototype_component_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "easyv_prototype_component_source_dataset_check"
        CHECK ("source_dataset_key" = 'easyv-prototype-task')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "easyv_prototype_layout_signature_idx"
    ON "facts"."easyv_prototype_layout" ("product_version_id", "layout_signature");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_prototype_block_app_idx"
    ON "facts"."easyv_prototype_block" ("product_version_id", "app_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_prototype_block_scheme_idx"
    ON "facts"."easyv_prototype_block" ("product_version_id", "scheme_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_prototype_component_app_idx"
    ON "facts"."easyv_prototype_component" ("product_version_id", "app_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "easyv_prototype_component_family_idx"
    ON "facts"."easyv_prototype_component" ("product_version_id", "chart_family");
--> statement-breakpoint

DO $$
DECLARE
    relation text;
BEGIN
    FOREACH relation IN ARRAY ARRAY['easyv_prototype_layout', 'easyv_prototype_block', 'easyv_prototype_component']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = relation || '_building_insert_trg'
                       AND tgrelid = ('facts.' || relation)::regclass) THEN
            EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON facts.%I FOR EACH ROW '
                'EXECUTE FUNCTION ingestion.guard_canonical_fact_insert()',
                relation || '_building_insert_trg', relation);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = relation || '_immutable_trg'
                       AND tgrelid = ('facts.' || relation)::regclass) THEN
            EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON facts.%I FOR EACH ROW '
                'EXECUTE FUNCTION ingestion.guard_immutable_row_mutation()',
                relation || '_immutable_trg', relation);
        END IF;
    END LOOP;
END;
$$;
--> statement-breakpoint

UPDATE "ingestion"."dataset_definitions"
SET "column_contract" = '[
    {"name":"id","type":"LONG","nullable":false},
    {"name":"app_id","type":"STRING","nullable":false},
    {"name":"screen_structure_xml","type":"STRING","nullable":true},
    {"name":"screen_prototype_json","type":"JSON","nullable":true},
    {"name":"create_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"create_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}},
    {"name":"update_time","type":"TIMESTAMP_WITHOUT_TIME_ZONE","nullable":false,
      "timeSemantics":{"column":"update_time","kind":"TIMESTAMP_WITHOUT_TIME_ZONE","zoneId":"Asia/Shanghai"}}
 ]'::jsonb,
    "schema_version" = 2,
    "metadata" = '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sensitiveColumnsExcluded":["screen_template_json","screen_app_json","block_ids","warnings"],"stagingRetains":["screen_structure_xml","screen_prototype_json"],"factsPersist":"structure only; titles, descriptions, metric names and files are never written to facts","historyCoverage":"latest prototype state only; no revision history at source","schemaV2":"adds layout XML and prototype JSON; first ingestion after the change must be FULL"}'::jsonb,
    "updated_at" = now()
WHERE "dataset_key" = 'easyv-prototype-task' AND "schema_version" = 1;
--> statement-breakpoint

INSERT INTO "ingestion"."data_product_definitions"
    ("product_key", "domain_key", "canonical_schema", "canonical_relation",
     "transform_ref", "schema_version", "freshness_policy", "status", "metadata")
VALUES
('easyv-prototype-layout', 'easyv', 'facts', 'easyv_prototype_layout', 'easyv-prototype-layout-v1', 1,
 '{"mode":"watermark+snapshot_diff","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-prototype-task","primaryKey":["product_version_id","source_id"],"parseFailures":"kept as rows with parse_status <> ok"}'::jsonb),
('easyv-prototype-block', 'easyv', 'facts', 'easyv_prototype_block', 'easyv-prototype-block-v1', 1,
 '{"mode":"watermark+snapshot_diff","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-prototype-task","primaryKey":["product_version_id","source_id","block_id"]}'::jsonb),
('easyv-prototype-component', 'easyv', 'facts', 'easyv_prototype_component', 'easyv-prototype-component-v1', 1,
 '{"mode":"watermark+snapshot_diff","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"easyv-prototype-task","primaryKey":["product_version_id","source_id","component_id"]}'::jsonb)
ON CONFLICT ("product_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."data_product_inputs"
    ("product_key", "input_key", "dataset_key", "ordinal", "is_required", "mapping_spec", "metadata")
VALUES
('easyv-prototype-layout', 'source', 'easyv-prototype-task', 0, true,
 '{"id":"source_id","app_id":"app_id","screen_structure_xml":"parsed","screen_prototype_json":"parsed","create_time":"created_at","update_time":"updated_at"}'::jsonb, '{}'::jsonb),
('easyv-prototype-block', 'source', 'easyv-prototype-task', 0, true,
 '{"id":"source_id","app_id":"app_id","screen_structure_xml":"parsed","screen_prototype_json":"parsed","create_time":"created_at"}'::jsonb, '{}'::jsonb),
('easyv-prototype-component', 'source', 'easyv-prototype-task', 0, true,
 '{"id":"source_id","app_id":"app_id","screen_structure_xml":"parsed","screen_prototype_json":"parsed","create_time":"created_at"}'::jsonb, '{}'::jsonb)
ON CONFLICT ("product_key", "input_key") DO NOTHING;
