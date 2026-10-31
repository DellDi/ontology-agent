-- 仅影响后续发布产品，不回填既有冻结事实。
UPDATE ingestion.data_product_definitions SET transform_ref='easyv-prototype-layout-v5', schema_version=5,
 metadata=metadata || '{"dynamicPanels":"retain render/options, ordered state nodes and page panelSwitch semantics"}'::jsonb
 WHERE product_key='easyv-prototype-layout';
UPDATE ingestion.data_product_definitions SET transform_ref='easyv-prototype-block-v6', schema_version=6
 WHERE product_key='easyv-prototype-block';
UPDATE ingestion.data_product_definitions SET transform_ref='easyv-prototype-component-v4', schema_version=4
 WHERE product_key='easyv-prototype-component';
