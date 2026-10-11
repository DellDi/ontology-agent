-- 保留源导出的业务文案；旧冻结事实保持 null，须正式重新物化到新集合。
UPDATE ingestion.dataset_definitions
SET metadata=metadata || '{"factsPersist":"reviewed structure, geometry and source business descriptions; no arbitrary configs, files or source columns"}'::jsonb
WHERE dataset_key='easyv-prototype-task';
ALTER TABLE facts.easyv_prototype_layout ADD COLUMN IF NOT EXISTS page_semantics jsonb;
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS page_id text;
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS page_title text;
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS block_title text;
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS business_module text;
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS module_description text;
ALTER TABLE facts.easyv_prototype_block ADD COLUMN IF NOT EXISTS interaction_description text;
ALTER TABLE facts.easyv_prototype_component ADD COLUMN IF NOT EXISTS metric_name text;
ALTER TABLE facts.easyv_prototype_component ADD COLUMN IF NOT EXISTS metric_description text;
ALTER TABLE facts.easyv_prototype_component ADD COLUMN IF NOT EXISTS metric_insight text;
ALTER TABLE facts.easyv_prototype_component ADD COLUMN IF NOT EXISTS metric_unit text;
ALTER TABLE facts.easyv_prototype_component ADD COLUMN IF NOT EXISTS aggregation_rule text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='easyv_prototype_page_semantics_check'
      AND conrelid='facts.easyv_prototype_layout'::regclass) THEN
    ALTER TABLE facts.easyv_prototype_layout ADD CONSTRAINT easyv_prototype_page_semantics_check
      CHECK (page_semantics IS NULL OR (parse_status='ok' AND jsonb_typeof(page_semantics)='array'));
  END IF;
END;
$$;

UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-layout-v3',schema_version=3,
    metadata=metadata || '{"businessSemantics":"source page titles and whitelisted main visual descriptions; no industry inference","historyCoverage":"new materialization only; no frozen facts backfill"}'::jsonb
WHERE product_key='easyv-prototype-layout';
UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-block-v4',schema_version=4,
    metadata=metadata || '{"businessSemantics":"source page, module title, purpose and interaction description; identifiers are not business names","historyCoverage":"new materialization only; no frozen facts backfill"}'::jsonb
WHERE product_key='easyv-prototype-block';
UPDATE ingestion.data_product_definitions
SET transform_ref='easyv-prototype-component-v3',schema_version=3,
    metadata=metadata || '{"businessSemantics":"source metric name, description and insight; unit and aggregation rule require explicit unique metric binding","historyCoverage":"new materialization only; no frozen facts backfill"}'::jsonb
WHERE product_key='easyv-prototype-component';
UPDATE ingestion.data_product_inputs
SET mapping_spec=mapping_spec || '{"screen_prototype_json":"reviewed geometry and business semantics; structural signatures unchanged; no arbitrary config, files or source columns"}'::jsonb
WHERE product_key IN ('easyv-prototype-layout','easyv-prototype-block','easyv-prototype-component') AND input_key='source';
