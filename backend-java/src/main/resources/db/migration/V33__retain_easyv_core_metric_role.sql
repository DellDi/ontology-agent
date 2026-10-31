-- 新版 XML 的核心指标角色；旧冻结事实不回填，重新采集／物化后写入新版本。
ALTER TABLE facts.easyv_prototype_block
  ADD COLUMN IF NOT EXISTS metric_role text CHECK (metric_role IN ('core', 'module'));

UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-layout-v4', schema_version=4,
    metadata=metadata || '{"coreMetrics":"retain source role and fill-layout attributes; block count includes core and module blocks"}'::jsonb
WHERE product_key='easyv-prototype-layout';
UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-block-v5', schema_version=5,
    metadata=metadata || '{"coreMetrics":"one core metric per source Block; metricRole distinguishes core and module; old frozen facts unchanged"}'::jsonb
WHERE product_key='easyv-prototype-block';
