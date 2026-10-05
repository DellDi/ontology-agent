-- B1.4：复用流水线产品保存评分观测证据。源端编辑会覆盖再生成上下文，不能认证为原始输入。
-- 原始 output 仅进入受治理 staging；facts 由 Java 投影 ID、类型、数值和槽位，不保留原始大 JSON。
ALTER TABLE facts.easyv_pipeline_node
    ADD COLUMN IF NOT EXISTS score_snapshot_status text,
    ADD COLUMN IF NOT EXISTS score_snapshot_error_code text,
    ADD COLUMN IF NOT EXISTS score_snapshot jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'easyv_pipeline_node_score_snapshot_check'
          AND conrelid = 'facts.easyv_pipeline_node'::regclass) THEN
        ALTER TABLE facts.easyv_pipeline_node
            ADD CONSTRAINT easyv_pipeline_node_score_snapshot_check CHECK (
                CASE
                    WHEN score_snapshot_status IS NULL OR score_snapshot_status = 'not_applicable'
                        THEN score_snapshot IS NULL AND score_snapshot_error_code IS NULL
                    WHEN score_snapshot_status = 'available_unverified'
                        THEN score_snapshot IS NOT NULL AND jsonb_typeof(score_snapshot) = 'object'
                          AND score_snapshot_error_code IS NULL
                    WHEN score_snapshot_status IN ('missing', 'invalid')
                        THEN score_snapshot IS NULL AND score_snapshot_error_code IS NOT NULL
                          AND btrim(score_snapshot_error_code) <> ''
                    ELSE false
                END
            );
    END IF;
END;
$$;

UPDATE ingestion.dataset_definitions
SET column_contract = column_contract || '[{"name":"output","type":"JSON","nullable":true}]'::jsonb,
    schema_version = 2,
    metadata = metadata || '{"sensitiveColumnsExcluded":["session_id","role","show_message","intent"],"stagingRetains":["output"],"factsPersist":"reviewed score snapshot projection only; no names, descriptions, source columns, files or raw output","snapshotInputProvenance":"regen context is mutable after prototype edits; not a certified generation-time input","schemaV2":"adds output; FULL or RECONCILE required before v2 materialization"}'::jsonb,
    updated_at = now()
WHERE dataset_key = 'easyv-pipeline-node' AND schema_version = 1;

UPDATE ingestion.data_product_definitions
SET transform_ref = 'easyv-pipeline-node-v2', schema_version = 2,
    metadata = metadata || '{"scoreSnapshotSchemaVersion":1,"scoreSnapshotStatus":"available_unverified / missing / invalid / not_applicable; null in old frozen facts","historyCoverage":"source regen context can be overwritten; older facts are not backfilled","scoreNormalization":"not retained at source; do not label scores as percent","sourceRuleVersion":"not retained at source; current source code is not proof of historical runtime version"}'::jsonb
WHERE product_key = 'easyv-pipeline-node';

UPDATE ingestion.data_product_inputs
SET mapping_spec = mapping_spec || '{"output":"score_snapshot_projection"}'::jsonb
WHERE product_key = 'easyv-pipeline-node' AND input_key = 'source';
