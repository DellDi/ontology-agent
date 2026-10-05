-- B1 画布读取的结构输入：V21 扁平区域不足以还原页面与嵌套容器。
-- 只保留经过属性白名单提取的 XML 结构；不保存名称、描述或指标自由文本。
-- 旧冻结事实不回填、不改写，旧集合的 layout_structure 为 null，读取时须明确说明覆盖边界。
ALTER TABLE facts.easyv_prototype_layout
    ADD COLUMN IF NOT EXISTS layout_structure jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'easyv_prototype_layout_structure_check'
          AND conrelid = 'facts.easyv_prototype_layout'::regclass
    ) THEN
        ALTER TABLE facts.easyv_prototype_layout
            ADD CONSTRAINT easyv_prototype_layout_structure_check CHECK (
                layout_structure IS NULL
                OR (parse_status = 'ok' AND jsonb_typeof(layout_structure) = 'object')
            );
    END IF;
END;
$$;

UPDATE ingestion.data_product_definitions
SET transform_ref = 'easyv-prototype-layout-v2',
    schema_version = 2,
    metadata = metadata || '{"layoutStructureSchemaVersion":1,"layoutStructure":"ordered XML tree; geometry and object references only","historyCoverage":"layout_structure is absent in previously published v1 facts; rematerialize the retained v2 source into a new frozen set"}'::jsonb
WHERE product_key = 'easyv-prototype-layout';
