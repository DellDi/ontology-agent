-- B1.4：方案与槽位类型共同冻结为一个评估输入产品。
-- 源字段实际为 varchar JSON（源 DDL v8.17.0），不要声明为原生 jsonb 绕过源契约校验。
CREATE TABLE IF NOT EXISTS facts.easyv_scheme_library (
    product_version_id text NOT NULL REFERENCES ingestion.data_product_versions(id),
    source_dataset_key text NOT NULL CHECK (source_dataset_key = 'easyv-block-scheme'),
    source_dataset_version_id text NOT NULL,
    source_id bigint NOT NULL,
    block_type_id text NOT NULL,
    chart_count integer NOT NULL,
    pattern_tag text,
    parse_status text NOT NULL,
    parse_error_code text,
    slots jsonb,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_version_id, source_id),
    FOREIGN KEY (source_dataset_key, source_dataset_version_id)
        REFERENCES ingestion.source_dataset_versions(dataset_key,id),
    CONSTRAINT easyv_scheme_library_parse_check CHECK (
        CASE WHEN parse_status = 'available' THEN parse_error_code IS NULL
              AND slots IS NOT NULL AND jsonb_typeof(slots) = 'array'
             WHEN parse_status IN ('missing','invalid') THEN slots IS NULL
              AND parse_error_code IS NOT NULL AND btrim(parse_error_code) <> ''
             ELSE false END)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_scheme_library_building_insert_trg'
        AND tgrelid='facts.easyv_scheme_library'::regclass) THEN
        CREATE TRIGGER easyv_scheme_library_building_insert_trg BEFORE INSERT ON facts.easyv_scheme_library
            FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_scheme_library_immutable_trg'
        AND tgrelid='facts.easyv_scheme_library'::regclass) THEN
        CREATE TRIGGER easyv_scheme_library_immutable_trg BEFORE UPDATE OR DELETE ON facts.easyv_scheme_library
            FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
END;
$$;

INSERT INTO ingestion.dataset_definitions
    (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,column_contract,
     cursor_spec,delete_policy,delete_spec,schema_version,status,metadata)
VALUES
('easyv-block-scheme','easyv','easyv_saas','ai_block_data',ARRAY['id'],
 '[{"name":"id","type":"INTEGER","nullable":false},
   {"name":"chat_count","type":"INTEGER","nullable":false},
   {"name":"block_type_id","type":"STRING","nullable":false},
   {"name":"block_slots_data","type":"STRING","nullable":false},
   {"name":"pattern_tag","type":"STRING","nullable":true}]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,
 'snapshot_diff','{}'::jsonb,1,'active',
 '{"reconciliation":"required: mutable configuration has no update watermark","factsPersist":"reviewed slot projection; excludes name and bindMetric","sourceDdl":"v8.17.0-20260604"}'::jsonb),
('easyv-slot-type','easyv','easyv_saas','ai_block_internal_data',ARRAY['id'],
 '[{"name":"id","type":"INTEGER","nullable":false},
   {"name":"recommend_type","type":"STRING","nullable":false},
   {"name":"allowed_chart_categories","type":"STRING","nullable":true}]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,
 'snapshot_diff','{}'::jsonb,1,'active',
 '{"reconciliation":"required: mutable configuration has no update watermark","factsPersist":"recommendation group labels are configuration, not expanded chart types","sourceDdl":"v8.17.0-20260604"}'::jsonb)
ON CONFLICT (dataset_key) DO NOTHING;

INSERT INTO ingestion.data_product_definitions
    (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,schema_version,
     freshness_policy,status,metadata)
VALUES ('easyv-scheme-library','easyv','facts','easyv_scheme_library','easyv-scheme-library-v1',1,
    '{"mode":"reconcile"}'::jsonb,'active',
    '{"primaryKey":["product_version_id","source_id"],"slotOrder":"row then col, stable for ties; matches source convertToScheme","coverage":"configuration captured at platform ingestion; not historical generation-time configuration","parseStatus":"available / missing / invalid","semanticExposure":"domain evaluation input; not a semantic statistics object"}'::jsonb)
ON CONFLICT (product_key) DO NOTHING;

INSERT INTO ingestion.data_product_inputs
    (product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES
('easyv-scheme-library','source','easyv-block-scheme',0,true,
 '{"id":"source_id","chat_count":"chart_count","block_type_id":"block_type_id","pattern_tag":"pattern_tag","block_slots_data":"slots:reviewed projection"}'::jsonb,'{}'::jsonb),
('easyv-scheme-library','slot-types','easyv-slot-type',1,true,
 '{"id":"slots.internalId","allowed_chart_categories":"slots.allowedChartCategories","recommend_type":"slots.recommendedGroups"}'::jsonb,
 '{"join":"block_slots_data.block_internal_id to id","lineage":"both immutable source versions recorded by materializer"}'::jsonb)
ON CONFLICT (product_key,input_key) DO NOTHING;
