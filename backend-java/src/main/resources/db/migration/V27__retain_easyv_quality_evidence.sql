-- 质量闭环 P0：原话来自操作日志，执行节点与轮次保持多对多关联，不把节点数当修改轮次。
ALTER TABLE facts.easyv_generation_feedback
    ADD COLUMN IF NOT EXISTS user_input text,
    ADD COLUMN IF NOT EXISTS user_input_hash text,
    ADD COLUMN IF NOT EXISTS user_input_truncated boolean,
    ADD COLUMN IF NOT EXISTS failure_reason text,
    ADD COLUMN IF NOT EXISTS failure_reason_hash text,
    ADD COLUMN IF NOT EXISTS failure_reason_truncated boolean;

ALTER TABLE facts.easyv_pipeline_node
    ADD COLUMN IF NOT EXISTS app_id text,
    ADD COLUMN IF NOT EXISTS session_id text,
    ADD COLUMN IF NOT EXISTS intent text,
    ADD COLUMN IF NOT EXISTS target_block_id text,
    ADD COLUMN IF NOT EXISTS industry_category text,
    ADD COLUMN IF NOT EXISTS audience_type text,
    ADD COLUMN IF NOT EXISTS quality_evidence_status text,
    ADD COLUMN IF NOT EXISTS quality_evidence_error_code text,
    ADD COLUMN IF NOT EXISTS quality_evidence jsonb;

UPDATE ingestion.dataset_definitions
SET column_contract = column_contract || '[{"name":"user_input","type":"STRING","nullable":true},{"name":"fail_reason","type":"STRING","nullable":true}]'::jsonb,
    schema_version = 2,
    metadata = metadata || '{"sensitiveColumnsExcluded":["description","metadata"],"factsPersist":"bounded user_input and fail_reason; explicit truncation flags; single-object detail only","schemaV2":"FULL or RECONCILE required; historical frozen facts are not backfilled"}'::jsonb,
    updated_at = now()
WHERE dataset_key = 'easyv-generation-feedback' AND schema_version = 1;

UPDATE ingestion.dataset_definitions
SET column_contract = column_contract || '[{"name":"session_id","type":"STRING","nullable":true},{"name":"intent","type":"STRING","nullable":true}]'::jsonb,
    schema_version = 3,
    metadata = metadata || '{"sensitiveColumnsExcluded":["role","show_message"],"factsPersist":"reviewed score snapshot and Step1 quality projection; ChatExecution target block; never UserPrompt or raw output","schemaV3":"FULL or RECONCILE required; source deletion lifecycle unchanged pending U1"}'::jsonb,
    updated_at = now()
WHERE dataset_key = 'easyv-pipeline-node' AND schema_version = 2;

UPDATE ingestion.data_product_definitions
SET transform_ref = 'easyv-generation-feedback-v2', schema_version = 2,
    metadata = metadata || '{"qualityTextLimit":4000,"textExposure":"single-object detail only","ratingSemantics":"whole-screen 1-5 or per-round vote 4/2; save-as is adoption signal, not satisfaction"}'::jsonb
WHERE product_key = 'easyv-generation-feedback';

UPDATE ingestion.data_product_definitions
SET transform_ref = 'easyv-pipeline-node-v3', schema_version = 3,
    metadata = metadata || '{"qualityEvidence":"Step1 understanding is system output, not independently verified business truth","chatNodeSemantics":"multiple ChatExecution nodes may belong to one task; preserve every node","deletionRetention":"not implemented; NONE alone does not retain FULL/RECONCILE history"}'::jsonb
WHERE product_key = 'easyv-pipeline-node';

UPDATE ingestion.data_product_inputs
SET mapping_spec = mapping_spec || '{"user_input":"user_input, user_input_hash, user_input_truncated","fail_reason":"failure_reason, failure_reason_hash, failure_reason_truncated"}'::jsonb
WHERE product_key = 'easyv-generation-feedback' AND input_key = 'source';

UPDATE ingestion.data_product_inputs
SET mapping_spec = mapping_spec || '{"session_id":"session_id","intent":"intent","output":"reviewed score and quality projections"}'::jsonb
WHERE product_key = 'easyv-pipeline-node' AND input_key = 'source';

-- 修改任务不是应用 generation_task_id；以同次采集的操作日志 task_id→app_id 关联，血缘显式留存。
INSERT INTO ingestion.data_product_inputs
    (product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-pipeline-node','operations','easyv-generation-feedback',1,true,
    '{"task_id":"task-to-application join","app_id":"app_id"}'::jsonb,
    '{"association":"exact task_id; ambiguous mappings fail; unmapped nodes remain facts but are not exposed as owned application evidence"}'::jsonb)
ON CONFLICT (product_key,input_key) DO NOTHING;
