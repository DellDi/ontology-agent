-- B1.4 评分核验与候选比较的当前输入；只投影 ID、槽位和类型，不保存指标名称或源列。
-- 旧冻结 facts 保持 null，不以当前 staging 补造历史绑定。
ALTER TABLE facts.easyv_prototype_block
    ADD COLUMN IF NOT EXISTS metric_binding_status text,
    ADD COLUMN IF NOT EXISTS metric_bindings jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'easyv_prototype_block_metric_bindings_check'
          AND conrelid = 'facts.easyv_prototype_block'::regclass) THEN
        ALTER TABLE facts.easyv_prototype_block
            ADD CONSTRAINT easyv_prototype_block_metric_bindings_check CHECK (
        CASE
            WHEN metric_binding_status IS NULL THEN metric_bindings IS NULL
            WHEN metric_binding_status = 'available' THEN
                metric_bindings IS NOT NULL AND
                CASE WHEN jsonb_typeof(metric_bindings) = 'array'
                    THEN jsonb_array_length(metric_bindings) = component_count ELSE false END
            WHEN metric_binding_status IN ('not_retained', 'invalid') THEN metric_bindings IS NULL
            ELSE false
        END
            );
    END IF;
END;
$$;

UPDATE ingestion.data_product_definitions
SET transform_ref = 'easyv-prototype-block-v2',
    schema_version = 2,
    metadata = metadata || '{"metricBindingSchemaVersion":1,"metricBindings":"components and boundMetricIds in source export slot order; identifiers and types only","metricBindingStatus":"available / not_retained / invalid; null in older frozen facts","historyCoverage":"old block facts are not backfilled; rematerialize retained prototype source v2 into a new frozen set"}'::jsonb
WHERE product_key = 'easyv-prototype-block';
