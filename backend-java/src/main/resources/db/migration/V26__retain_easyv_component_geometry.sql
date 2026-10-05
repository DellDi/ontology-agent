-- B1.4 的真实当前排布输入；不保存标题文字，旧冻结事实不回填。
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS title_present boolean;
ALTER TABLE facts.easyv_prototype_component ADD COLUMN IF NOT EXISTS geometry jsonb;

UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-block-v3',schema_version=3,
    metadata=metadata || '{"titlePresence":"trimmed source title presence only; null in old facts or invalid source title","historyCoverage":"rematerialize retained prototype source v2; no backfill"}'::jsonb
WHERE product_key='easyv-prototype-block';
UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-component-v2',schema_version=2,
    metadata=metadata || '{"geometrySchemaVersion":1,"geometry":"reviewed percentage box: available / missing / invalid; null in old facts","historyCoverage":"no rendering defaults or backfill"}'::jsonb
WHERE product_key='easyv-prototype-component';
UPDATE ingestion.data_product_inputs
SET mapping_spec=mapping_spec || '{"screen_prototype_json":"reviewed component geometry and title presence"}'::jsonb
WHERE product_key IN ('easyv-prototype-block','easyv-prototype-component') AND input_key='source';
