-- EasyV v8.22 全局图表参考配置与管理员后台配置审计。仅注册只读采集，不执行源库操作。
-- JSON 列在源端是 varchar/text，必须按源契约采集再校验解析；operator 是后台令牌标识，不采集。

CREATE TABLE IF NOT EXISTS facts.easyv_chart_type (
 product_version_id text NOT NULL REFERENCES ingestion.data_product_versions(id),
 source_dataset_key text NOT NULL CHECK(source_dataset_key='easyv-chart-type'),
 source_dataset_version_id text NOT NULL,
 source_id bigint NOT NULL, chart_type text NOT NULL, chart_family text NOT NULL, scene_tag text NOT NULL,
 description_terms text, data_requirement text, suitable_for text, is_fallback boolean NOT NULL,
 status text NOT NULL CHECK(status IN ('0','1')), sort_order integer NOT NULL,
 UNIQUE(product_version_id,chart_type),
 ingested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_version_id,source_id),
 FOREIGN KEY(source_dataset_key,source_dataset_version_id) REFERENCES ingestion.source_dataset_versions(dataset_key,id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_chart_type_building_insert_trg' AND tgrelid='facts.easyv_chart_type'::regclass) THEN
  CREATE TRIGGER easyv_chart_type_building_insert_trg BEFORE INSERT ON facts.easyv_chart_type
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_chart_type_immutable_trg' AND tgrelid='facts.easyv_chart_type'::regclass) THEN
  CREATE TRIGGER easyv_chart_type_immutable_trg BEFORE UPDATE OR DELETE ON facts.easyv_chart_type
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
 END IF;
END $$;

INSERT INTO ingestion.dataset_definitions
 (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status,metadata)
VALUES ('easyv-chart-type','easyv','easyv_saas','ai_chart_type_mapping',ARRAY['id'],'[{"name": "id", "type": "INTEGER", "nullable": false}, {"name": "chart_type", "type": "STRING", "nullable": false}, {"name": "chart_family", "type": "STRING", "nullable": false}, {"name": "scene_tag", "type": "STRING", "nullable": false}, {"name": "description_terms", "type": "STRING", "nullable": true}, {"name": "data_requirement", "type": "STRING", "nullable": true}, {"name": "suitable_for", "type": "STRING", "nullable": true}, {"name": "is_fallback", "type": "INTEGER", "nullable": false}, {"name": "status", "type": "STRING", "nullable": false}, {"name": "sort_order", "type": "INTEGER", "nullable": false}]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,'snapshot_diff','{}'::jsonb,1,'active',
 '{"sourceDdl":"v8.22.0-20261022","coverage":"configuration at ingestion; not generation-time history","access":"global-reference"}'::jsonb)
ON CONFLICT(dataset_key) DO NOTHING;
INSERT INTO ingestion.data_product_definitions
 (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,schema_version,freshness_policy,status,metadata)
VALUES ('easyv-chart-type','easyv','facts','easyv_chart_type','easyv-chart-type-v1',1,'{"mode":"reconcile"}'::jsonb,'active',
 '{"primaryKey":["product_version_id","source_id"],"emptyRelations":"preserved with null chart; excluded from relation counts"}'::jsonb)
ON CONFLICT(product_key) DO NOTHING;
INSERT INTO ingestion.data_product_inputs(product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-chart-type','source','easyv-chart-type',0,true,'{}'::jsonb,'{}'::jsonb)
ON CONFLICT(product_key,input_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS facts.easyv_chart_category (
 product_version_id text NOT NULL REFERENCES ingestion.data_product_versions(id),
 source_dataset_key text NOT NULL CHECK(source_dataset_key='easyv-chart-category'),
 source_dataset_version_id text NOT NULL,
 membership_id text NOT NULL, source_id bigint NOT NULL, category_id text NOT NULL,
 category_name text NOT NULL, chart_type text, position integer CHECK(position > 0), sort_order integer NOT NULL,
 ingested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_version_id,membership_id),
 FOREIGN KEY(source_dataset_key,source_dataset_version_id) REFERENCES ingestion.source_dataset_versions(dataset_key,id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_chart_category_building_insert_trg' AND tgrelid='facts.easyv_chart_category'::regclass) THEN
  CREATE TRIGGER easyv_chart_category_building_insert_trg BEFORE INSERT ON facts.easyv_chart_category
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_chart_category_immutable_trg' AND tgrelid='facts.easyv_chart_category'::regclass) THEN
  CREATE TRIGGER easyv_chart_category_immutable_trg BEFORE UPDATE OR DELETE ON facts.easyv_chart_category
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
 END IF;
END $$;

INSERT INTO ingestion.dataset_definitions
 (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status,metadata)
VALUES ('easyv-chart-category','easyv','easyv_saas','ai_chart_category',ARRAY['id'],'[{"name": "id", "type": "INTEGER", "nullable": false}, {"name": "category_name", "type": "STRING", "nullable": false}, {"name": "chart_types", "type": "STRING", "nullable": false}, {"name": "sort_order", "type": "INTEGER", "nullable": false}]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,'snapshot_diff','{}'::jsonb,1,'active',
 '{"sourceDdl":"v8.22.0-20261022","coverage":"configuration at ingestion; not generation-time history","access":"global-reference"}'::jsonb)
ON CONFLICT(dataset_key) DO NOTHING;
INSERT INTO ingestion.data_product_definitions
 (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,schema_version,freshness_policy,status,metadata)
VALUES ('easyv-chart-category','easyv','facts','easyv_chart_category','easyv-chart-category-v1',1,'{"mode":"reconcile"}'::jsonb,'active',
 '{"primaryKey":["product_version_id","membership_id"],"emptyRelations":"preserved with null chart; excluded from relation counts"}'::jsonb)
ON CONFLICT(product_key) DO NOTHING;
INSERT INTO ingestion.data_product_inputs(product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-chart-category','source','easyv-chart-category',0,true,'{}'::jsonb,'{}'::jsonb)
ON CONFLICT(product_key,input_key) DO NOTHING;
INSERT INTO ingestion.data_product_inputs(product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-chart-category','charts','easyv-chart-type',1,true,'{"chart_type":"chart_type"}'::jsonb,
 '{"validation":"all nonempty chart references must exist; includes disabled charts"}'::jsonb)
ON CONFLICT(product_key,input_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS facts.easyv_chart_priority (
 product_version_id text NOT NULL REFERENCES ingestion.data_product_versions(id),
 source_dataset_key text NOT NULL CHECK(source_dataset_key='easyv-chart-priority'),
 source_dataset_version_id text NOT NULL,
 recommendation_id text NOT NULL, source_id bigint NOT NULL, scene_id text NOT NULL,
 scene_type text NOT NULL, chart_type text, priority text CHECK(priority IN ('primary','secondary','tertiary','fallback')),
 position integer CHECK(position > 0), sort_order integer NOT NULL,
 ingested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_version_id,recommendation_id),
 FOREIGN KEY(source_dataset_key,source_dataset_version_id) REFERENCES ingestion.source_dataset_versions(dataset_key,id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_chart_priority_building_insert_trg' AND tgrelid='facts.easyv_chart_priority'::regclass) THEN
  CREATE TRIGGER easyv_chart_priority_building_insert_trg BEFORE INSERT ON facts.easyv_chart_priority
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_chart_priority_immutable_trg' AND tgrelid='facts.easyv_chart_priority'::regclass) THEN
  CREATE TRIGGER easyv_chart_priority_immutable_trg BEFORE UPDATE OR DELETE ON facts.easyv_chart_priority
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
 END IF;
END $$;

INSERT INTO ingestion.dataset_definitions
 (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status,metadata)
VALUES ('easyv-chart-priority','easyv','easyv_saas','ai_scene_chart_priority',ARRAY['id'],'[{"name": "id", "type": "INTEGER", "nullable": false}, {"name": "scene_type", "type": "STRING", "nullable": false}, {"name": "primary_charts", "type": "STRING", "nullable": false}, {"name": "secondary_charts", "type": "STRING", "nullable": false}, {"name": "tertiary_charts", "type": "STRING", "nullable": false}, {"name": "fallback_chart", "type": "STRING", "nullable": true}, {"name": "sort_order", "type": "INTEGER", "nullable": false}]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,'snapshot_diff','{}'::jsonb,1,'active',
 '{"sourceDdl":"v8.22.0-20261022","coverage":"configuration at ingestion; not generation-time history","access":"global-reference"}'::jsonb)
ON CONFLICT(dataset_key) DO NOTHING;
INSERT INTO ingestion.data_product_definitions
 (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,schema_version,freshness_policy,status,metadata)
VALUES ('easyv-chart-priority','easyv','facts','easyv_chart_priority','easyv-chart-priority-v1',1,'{"mode":"reconcile"}'::jsonb,'active',
 '{"primaryKey":["product_version_id","recommendation_id"],"emptyRelations":"preserved with null chart; excluded from relation counts"}'::jsonb)
ON CONFLICT(product_key) DO NOTHING;
INSERT INTO ingestion.data_product_inputs(product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-chart-priority','source','easyv-chart-priority',0,true,'{}'::jsonb,'{}'::jsonb)
ON CONFLICT(product_key,input_key) DO NOTHING;
INSERT INTO ingestion.data_product_inputs(product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-chart-priority','charts','easyv-chart-type',1,true,'{"chart_type":"chart_type"}'::jsonb,
 '{"validation":"all nonempty chart references must exist; includes disabled charts"}'::jsonb)
ON CONFLICT(product_key,input_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS facts.easyv_config_audit (
 product_version_id text NOT NULL REFERENCES ingestion.data_product_versions(id),
 source_dataset_key text NOT NULL CHECK(source_dataset_key='easyv-config-audit'),
 source_dataset_version_id text NOT NULL,
 source_id bigint NOT NULL, table_name text NOT NULL, row_key text NOT NULL,
 action text NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE','STATUS')), before_snapshot jsonb, after_snapshot jsonb,
 has_before boolean NOT NULL, has_after boolean NOT NULL, created_at timestamptz NOT NULL,
 CHECK(has_before = (before_snapshot IS NOT NULL)), CHECK(has_after = (after_snapshot IS NOT NULL)),
 ingested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_version_id,source_id),
 FOREIGN KEY(source_dataset_key,source_dataset_version_id) REFERENCES ingestion.source_dataset_versions(dataset_key,id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_config_audit_building_insert_trg' AND tgrelid='facts.easyv_config_audit'::regclass) THEN
  CREATE TRIGGER easyv_config_audit_building_insert_trg BEFORE INSERT ON facts.easyv_config_audit
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='easyv_config_audit_immutable_trg' AND tgrelid='facts.easyv_config_audit'::regclass) THEN
  CREATE TRIGGER easyv_config_audit_immutable_trg BEFORE UPDATE OR DELETE ON facts.easyv_config_audit
   FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
 END IF;
END $$;

INSERT INTO ingestion.dataset_definitions
 (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status,metadata)
VALUES ('easyv-config-audit','easyv','easyv_saas','ai_block_admin_audit',ARRAY['id'],'[{"name": "id", "type": "LONG", "nullable": false}, {"name": "table_name", "type": "STRING", "nullable": false}, {"name": "row_key", "type": "STRING", "nullable": false}, {"name": "action", "type": "STRING", "nullable": false}, {"name": "before_json", "type": "STRING", "nullable": true}, {"name": "after_json", "type": "STRING", "nullable": true}, {"name": "created_at", "type": "TIMESTAMPTZ", "nullable": false}]'::jsonb,
 '{"strategy":"RECONCILE","watermarkColumn":null,"tieBreakerColumn":null}'::jsonb,'snapshot_diff','{}'::jsonb,1,'active',
 '{"sourceDdl":"v8.22.0-20261022","coverage":"configuration at ingestion; not generation-time history","access":"platform-admin"}'::jsonb)
ON CONFLICT(dataset_key) DO NOTHING;
INSERT INTO ingestion.data_product_definitions
 (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,schema_version,freshness_policy,status,metadata)
VALUES ('easyv-config-audit','easyv','facts','easyv_config_audit','easyv-config-audit-v1',1,'{"mode":"reconcile"}'::jsonb,'active',
 '{"primaryKey":["product_version_id","source_id"],"emptyRelations":"preserved with null chart; excluded from relation counts"}'::jsonb)
ON CONFLICT(product_key) DO NOTHING;
INSERT INTO ingestion.data_product_inputs(product_key,input_key,dataset_key,ordinal,is_required,mapping_spec,metadata)
VALUES ('easyv-config-audit','source','easyv-config-audit',0,true,'{}'::jsonb,'{}'::jsonb)
ON CONFLICT(product_key,input_key) DO NOTHING;
