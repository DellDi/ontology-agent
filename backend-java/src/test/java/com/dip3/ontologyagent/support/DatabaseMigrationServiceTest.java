package com.dip3.ontologyagent.support;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
class DatabaseMigrationServiceTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private static JdbcTemplate jdbc;

    @BeforeAll
    static void setup() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }

    @BeforeEach
    void resetDatabase() {
        jdbc.execute("drop schema if exists facts cascade");
        jdbc.execute("drop schema if exists platform cascade");
        jdbc.execute("drop schema if exists erp_staging cascade");
        jdbc.execute("drop schema if exists ingestion cascade");
        jdbc.execute("drop table if exists public.spring_ai_chat_memory cascade");
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");
    }

    private DatabaseMigrationService service() {
        return new DatabaseMigrationService(jdbc.getDataSource());
    }

    private boolean historyExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.flyway_schema_history') is not null", Boolean.class));
    }

    @Test
    void freshDatabaseRunsInitAndIncrementalScripts() {
        DatabaseMigrationService.Decision decision = service().run();
        assertEquals(DatabaseMigrationService.Decision.INITIALIZED, decision);

        Integer applied = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where success", Integer.class);
        assertEquals(10, applied, "新库应执行到 V10 Property canonical facts");
        assertEquals("jsonb", jdbc.queryForObject("""
                select data_type from information_schema.columns
                where table_schema='platform' and table_name='analysis_execution_snapshots'
                  and column_name='capability_binding'
                """, String.class));
        assertEquals("NO", jdbc.queryForObject("""
                select is_nullable from information_schema.columns
                where table_schema='platform' and table_name='analysis_execution_snapshots'
                  and column_name='capability_binding'
                """, String.class));
        assertEquals("", jdbc.queryForObject("""
                select coalesce(column_default, '') from information_schema.columns
                where table_schema='platform' and table_name='analysis_execution_snapshots'
                  and column_name='capability_binding'
                """, String.class));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='platform' and table_name='analysis_session_follow_ups'
                  and column_name='capability_binding' and data_type='jsonb'
                  and is_nullable='NO' and column_default is null
                """, Integer.class));
        assertEquals(3, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='platform'
                  and table_name in ('jobs','analysis_execution_snapshots','analysis_session_follow_ups')
                  and column_name='dataset_version_set_id' and is_nullable='YES'
                """, Integer.class));
        Integer platformTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'platform'", Integer.class);
        assertTrue(platformTables >= 20, "初始化应建齐 platform 业务表");
        Integer erpTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'erp_staging'", Integer.class);
        assertTrue(erpTables >= 9, "初始化应建齐 erp_staging 表");
        Integer ingestionTables = jdbc.queryForObject("""
                select count(*) from pg_tables
                where schemaname='ingestion'
                  and tablename in ('source_definitions','dataset_definitions',
                                    'data_product_definitions','data_product_inputs',
                                    'source_ingestion_runs','source_dataset_versions',
                                    'dataset_cursors','product_materialization_runs',
                                    'data_product_versions','data_product_version_lineage',
                                    'dataset_version_sets','dataset_version_set_items',
                                    'source_dataset_batches')
                """, Integer.class);
        assertEquals(13, ingestionTables, "V5/V6 应建齐 ingestion 控制面与 durable batch 表");
        assertEquals(6, jdbc.queryForObject("""
                select count(*) from pg_tables
                where schemaname='facts' and tablename in
                  ('property_organization','property_project','property_charge_item',
                   'property_receivable','property_payment','property_service_order')
                """, Integer.class), "V10 应建齐 Property typed facts");
        assertEquals(6, jdbc.queryForObject("""
                select count(*) from ingestion.data_product_definitions
                where domain_key='property' and status='active'
                """, Integer.class), "V10 应注册 Property data products");
        assertEquals(18, jdbc.queryForObject(
                "select count(*) from pg_constraint c join pg_class t on c.conrelid=t.oid "
                        + "join pg_namespace n on t.relnamespace=n.oid "
                        + "where c.contype='f' and n.nspname='ingestion'", Integer.class),
                "V5 两阶段 ingestion 表之间应建立完整外键约束");
        String sourceVersionParentFk = jdbc.queryForObject("""
                select pg_get_constraintdef(oid)
                from pg_constraint
                where conname='source_dataset_versions_parent_fk'
                  and conrelid='ingestion.source_dataset_versions'::regclass
                """, String.class);
        assertTrue(sourceVersionParentFk.contains("FOREIGN KEY (dataset_key, parent_version_id)"));
        assertTrue(sourceVersionParentFk.contains("source_dataset_versions(dataset_key, id)"));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_trigger
                    where not tgisinternal
                      and tgname='source_dataset_versions_parent_guard_trg'
                      and tgrelid='ingestion.source_dataset_versions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='source_dataset_versions_run_dataset_unique'
                      and contype='u'
                      and conrelid='ingestion.source_dataset_versions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='source_dataset_versions_source_dataset_id_unique'
                      and contype='u'
                      and conrelid='ingestion.source_dataset_versions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='source_dataset_versions_dataset_version_unique'
                      and contype='u'
                      and conrelid='ingestion.source_dataset_versions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='data_product_versions_materialization_run_unique'
                      and contype='u'
                      and conrelid='ingestion.data_product_versions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='data_product_version_lineage_target_input_unique'
                      and contype='u'
                      and conrelid='ingestion.data_product_version_lineage'::regclass)
                """, Boolean.class)));
        assertFalse(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from information_schema.columns
                      where table_schema='ingestion'
                      and table_name in ('ingestion_runs','ingestion_cursors',
                                         'dataset_versions','dataset_lineage')
                      and table_name is not null)
                """, Boolean.class)));
        assertEquals("PRIMARY KEY (dataset_key)", jdbc.queryForObject("""
                select pg_get_constraintdef(oid)
                from pg_constraint
                where conrelid='ingestion.dataset_cursors'::regclass
                  and contype='p'
                """, String.class));
        String cursorVersionFk = jdbc.queryForObject("""
                select pg_get_constraintdef(oid)
                from pg_constraint
                where conname='dataset_cursors_last_version_fk'
                  and conrelid='ingestion.dataset_cursors'::regclass
                """, String.class);
        assertTrue(cursorVersionFk.contains("FOREIGN KEY (dataset_key, last_successful_version_id)"));
        assertTrue(cursorVersionFk.contains("source_dataset_versions(dataset_key, id)"));
        String sourceVersionDatasetFk = jdbc.queryForObject("""
                select pg_get_constraintdef(oid)
                from pg_constraint
                where conname='source_dataset_versions_dataset_fk'
                  and conrelid='ingestion.source_dataset_versions'::regclass
                """, String.class);
        assertTrue(sourceVersionDatasetFk.contains("FOREIGN KEY (source_key, dataset_key)"));
        assertTrue(sourceVersionDatasetFk.contains("dataset_definitions(source_key, dataset_key)"));
        String sourceVersionRunFk = jdbc.queryForObject("""
                select pg_get_constraintdef(oid)
                from pg_constraint
                where conname='source_dataset_versions_run_fk'
                  and conrelid='ingestion.source_dataset_versions'::regclass
                """, String.class);
        assertTrue(sourceVersionRunFk.contains("FOREIGN KEY (source_key, source_ingestion_run_id)"));
        assertTrue(sourceVersionRunFk.contains("source_ingestion_runs(source_key, id)"));
        String lineageInputFk = jdbc.queryForObject("""
                select pg_get_constraintdef(oid)
                from pg_constraint
                where conname='data_product_version_lineage_input_fk'
                  and conrelid='ingestion.data_product_version_lineage'::regclass
                """, String.class);
        assertTrue(lineageInputFk.contains("FOREIGN KEY (product_key, input_key, source_dataset_key)"));
        assertTrue(lineageInputFk.contains("data_product_inputs(product_key, input_key, dataset_key)"));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='ingestion' and table_name='dataset_definitions'
                  and column_name='column_contract' and data_type='jsonb'
                  and is_nullable='NO'
                """, Integer.class));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='ingestion' and table_name='source_dataset_batches'
                  and column_name='payload' and data_type='bytea' and is_nullable='NO'
                """, Integer.class));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='ingestion' and table_name='source_dataset_batches'
                  and column_name like '%json%'
                """, Integer.class));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='source_dataset_batches_codec_check'
                      and conrelid='ingestion.source_dataset_batches'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_trigger
                    where not tgisinternal
                      and tgname='source_dataset_batches_building_insert_trg'
                      and tgrelid='ingestion.source_dataset_batches'::regclass)
                """, Boolean.class)));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='ingestion' and table_name='source_dataset_versions'
                  and column_name='committed_cursor' and data_type='jsonb'
                  and is_nullable='NO'
                """, Integer.class));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='dataset_definitions_column_contract_non_empty_check'
                      and contype='c'
                      and conrelid='ingestion.dataset_definitions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='dataset_definitions_delete_policy_check'
                      and pg_get_constraintdef(oid) like '%snapshot_diff%'
                      and conrelid='ingestion.dataset_definitions'::regclass)
                """, Boolean.class)));
        assertEquals(3, jdbc.queryForObject("""
                select count(*) from pg_constraint
                where conrelid='ingestion.source_definitions'::regclass
                  and conname in ('source_definitions_key_check',
                                  'source_definitions_connector_type_check',
                                  'source_definitions_connection_ref_check')
                """, Integer.class));
        assertEquals(3, jdbc.queryForObject("""
                select count(*) from pg_constraint
                where conrelid='ingestion.data_product_definitions'::regclass
                  and conname in ('data_product_definitions_schema_check',
                                  'data_product_definitions_relation_check',
                                  'data_product_definitions_transform_ref_check')
                """, Integer.class));
        assertFalse(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from information_schema.columns
                    where table_schema='ingestion'
                      and table_name='source_definitions'
                      and column_name='metadata')
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='source_dataset_versions_published_check'
                      and pg_get_constraintdef(oid) like '%content_hash%'
                      and pg_get_constraintdef(oid) like '%source_watermark%'
                      and conrelid='ingestion.source_dataset_versions'::regclass)
                """, Boolean.class)));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists (
                    select 1 from pg_constraint
                    where conname='data_product_versions_published_check'
                      and pg_get_constraintdef(oid) like '%content_hash%'
                      and conrelid='ingestion.data_product_versions'::regclass)
                """, Boolean.class)));
        assertEquals("NO", jdbc.queryForObject("""
                select is_nullable from information_schema.columns
                where table_schema='ingestion'
                  and table_name='dataset_version_sets'
                  and column_name='created_by'
                """, String.class));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='ingestion'
                  and table_name='data_product_version_lineage'
                  and column_name in ('source_watermark', 'source_row_count')
                """, Integer.class));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from pg_tables
                where schemaname='ingestion'
                  and tablename in ('ingestion_runs','ingestion_cursors','dataset_versions','dataset_lineage')
                """, Integer.class));
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from pg_trigger
                where not tgisinternal
                  and tgname in ('source_dataset_versions_immutable_trg',
                                 'data_product_versions_immutable_trg',
                                 'data_product_version_lineage_immutable_trg',
                                 'dataset_version_set_items_immutable_trg',
                                 'source_dataset_batches_immutable_trg')
                """, Integer.class));
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from pg_tables
                where schemaname='facts'
                  and tablename in ('easyv_ai_application','easyv_prototype_task',
                                    'easyv_pipeline_node','easyv_forge_generation_task',
                                    'easyv_generation_feedback')
                """, Integer.class), "V8 应建立五个独立 EasyV canonical facts relation");
        assertEquals(10, jdbc.queryForObject("""
                select count(*) from pg_constraint c
                join pg_class t on c.conrelid=t.oid
                join pg_namespace n on t.relnamespace=n.oid
                where c.contype='f' and n.nspname='facts'
                  and t.relname in ('easyv_ai_application','easyv_prototype_task',
                                    'easyv_pipeline_node','easyv_forge_generation_task',
                                    'easyv_generation_feedback')
                """, Integer.class), "每个 facts relation 都必须绑定 product version 与同源 dataset version");
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from pg_trigger
                where not tgisinternal
                  and tgname in ('easyv_ai_application_immutable_trg',
                                 'easyv_prototype_task_immutable_trg',
                                 'easyv_pipeline_node_immutable_trg',
                                 'easyv_forge_generation_task_immutable_trg',
                                 'easyv_generation_feedback_immutable_trg')
                """, Integer.class), "facts 行必须沿用统一 immutable row trigger");
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from pg_trigger
                where not tgisinternal
                  and tgname in ('easyv_ai_application_building_insert_trg',
                                 'easyv_prototype_task_building_insert_trg',
                                 'easyv_pipeline_node_building_insert_trg',
                                 'easyv_forge_generation_task_building_insert_trg',
                                 'easyv_generation_feedback_building_insert_trg')
                """, Integer.class), "published product version 不能再追加 facts 行");
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from ingestion.data_product_definitions
                where domain_key='easyv' and canonical_schema='facts'
                  and product_key in ('easyv-ai-application','easyv-prototype-task',
                                      'easyv-pipeline-node','easyv-forge-task',
                                      'easyv-generation-feedback')
                """, Integer.class), "V8 应注册五个 EasyV data product");
        assertEquals("easyv-source", jdbc.queryForObject("""
                select connection_ref from ingestion.source_definitions
                where source_key='easyv'
                """, String.class), "catalog 只保存服务端 connection_ref，不保存连接密钥");
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from ingestion.dataset_definitions
                where source_key='easyv' and status='active'
                  and dataset_key in ('easyv-ai-application','easyv-prototype-task',
                                      'easyv-pipeline-node','easyv-forge-task',
                                      'easyv-generation-feedback')
                """, Integer.class), "V8 应注册五个 EasyV source dataset");
        assertEquals(5, jdbc.queryForObject("""
                select count(*) from ingestion.data_product_inputs
                where input_key='source' and is_required
                  and product_key in ('easyv-ai-application','easyv-prototype-task',
                                      'easyv-pipeline-node','easyv-forge-task',
                                      'easyv-generation-feedback')
                """, Integer.class), "每个 EasyV product 应绑定一个 source dataset");
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from ingestion.dataset_definitions
                where dataset_key='easyv-ai-application'
                  and cursor_spec->>'strategy'='WATERMARK'
                  and cursor_spec->>'watermarkColumn'='update_time'
                  and cursor_spec->>'tieBreakerColumn'='id'
                  and delete_policy='soft_delete'
                  and delete_spec->>'column'='is_delete'
                  and delete_spec->'deletedValues' @> '["1"]'::jsonb
                """, Integer.class));
        assertEquals(2, jdbc.queryForObject("""
                select count(*) from ingestion.dataset_definitions
                where dataset_key in ('easyv-prototype-task','easyv-forge-task')
                  and cursor_spec->>'strategy'='WATERMARK'
                  and cursor_spec->>'watermarkColumn'='update_time'
                  and cursor_spec->>'tieBreakerColumn'='id'
                  and delete_policy='snapshot_diff'
                """, Integer.class));
        assertEquals(2, jdbc.queryForObject("""
                select count(*) from ingestion.dataset_definitions
                where dataset_key in ('easyv-pipeline-node','easyv-generation-feedback')
                  and cursor_spec->>'strategy'='RECONCILE'
                  and delete_policy='snapshot_diff'
                """, Integer.class));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='facts'
                  and column_name in ('screen_structure_xml','screen_template_json',
                                      'screen_app_json','block_ids','warnings',
                                      'screen_prototype_json','output','show_message',
                                      'intent','pages_progress','user_input','fail_reason',
                                      'description','remark','metadata')
                """, Integer.class), "facts 不得落地大 JSON/XML、用户输入或描述字段");
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_schema='facts' and column_name='failure_reason'
                """, Integer.class), "Forge canonical facts 只允许保存失败原因 hash");
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.spring_ai_chat_memory') is not null", Boolean.class)));
        assertEquals(0, service().pendingMigrations().length);
    }

    @Test
    void existingFlywayHistoryIsIdempotent() {
        service().run();
        DatabaseMigrationService.Decision decision = service().run();
        assertEquals(DatabaseMigrationService.Decision.MIGRATED_INCREMENTAL, decision);
        Integer executed = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where type = 'SQL'", Integer.class);
        assertEquals(10, executed, "重复执行不得重跑已完成的 migration");
    }

    @Test
    void initScriptItselfIsReusable() {
        // 模拟不依赖 Flyway 的重复执行：先 Flyway 建库，清空历史后整份脚本重跑一遍，
        // 第二次必须全部 IF NOT EXISTS 跳过而不报错（DO $$ 块由 Flyway 执行器解析）。
        service().run();
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");

        service().run();

        Integer platformTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'platform'", Integer.class);
        assertTrue(platformTables >= 20, "重复执行后表结构应保持不变");
        Integer foreignKeys = jdbc.queryForObject(
                "select count(*) from pg_constraint where contype = 'f'", Integer.class);
        assertEquals(48, foreignKeys, "重复执行不应产生重复外键约束");
    }

    @Test
    void existingBusinessSchemaWithoutHistoryIsCompletedIdempotently() {
        // 模拟旧库：只有业务 schema（如旧 Drizzle 库），没有 Flyway 历史
        service().run();
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");
        assertFalse(historyExists());

        // 幂等 init 脚本对已有库直接补全，不报错、不丢数据
        DatabaseMigrationService.Decision decision = service().run();
        assertEquals(DatabaseMigrationService.Decision.INITIALIZED, decision);
        Integer applied = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where type = 'SQL' and success", Integer.class);
        assertEquals(10, applied, "旧库补全应记录 V1-V10（baseline 0 标记不计入）");
    }

    @Test
    void incrementalMigrationBackfillsExistingJavaJobBinding() {
        Flyway.configure().dataSource(jdbc.getDataSource()).locations("classpath:db/migration")
                .target("1").load().migrate();
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,attempt_count,max_attempts,available_at,dispatch_status,
                 owner_user_id,organization_id,session_id,origin_correlation_id,created_at,updated_at)
                values ('job-1','analysis-execution','queued',cast(? as jsonb),0,2,now(),'pending',
                        'user-1','org-1','session-1','trace-1',now(),now())
                """, """
                {"executionContract":"java-initial-v1","ontologyVersionId":"ontology-1",
                 "organizationId":"org-1","ownerUserId":"user-1","sessionId":"session-1",
                 "questionText":"分析收缴率","traceId":"trace-1",
                 "projectIds":["project-1"],"areaIds":[]}
                """);

        assertEquals(DatabaseMigrationService.Decision.MIGRATED_INCREMENTAL, service().run());

        assertEquals("property", jdbc.queryForObject(
                "select payload->'capabilityBinding'->>'domainKey' from platform.jobs where id='job-1'",
                String.class));
        assertEquals("project-1", jdbc.queryForObject("""
                select payload->'capabilityBinding'->'resolvedScope'->'values'->'projectIds'->>0
                from platform.jobs where id='job-1'
                """, String.class));
    }

    @Test
    void incrementalMigrationDoesNotInventBindingForMalformedHistoricalJob() {
        Flyway.configure().dataSource(jdbc.getDataSource()).locations("classpath:db/migration")
                .target("1").load().migrate();
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,attempt_count,max_attempts,available_at,dispatch_status,
                 owner_user_id,organization_id,session_id,origin_correlation_id,created_at,updated_at)
                values ('job-malformed','analysis-execution','queued',cast(? as jsonb),0,2,now(),'pending',
                        'user-1','org-1','session-1','trace-1',now(),now())
                """, """
                {"executionContract":"java-initial-v1","ontologyVersionId":"ontology-1",
                 "organizationId":"org-1","ownerUserId":"user-1","sessionId":"session-1",
                 "questionText":"","traceId":"trace-1","projectIds":["project-1"],"areaIds":[]}
                """);

        assertEquals(DatabaseMigrationService.Decision.MIGRATED_INCREMENTAL, service().run());

        assertFalse(Boolean.TRUE.equals(jdbc.queryForObject(
                "select payload ? 'capabilityBinding' from platform.jobs where id='job-malformed'",
                Boolean.class)));
    }

    @Test
    void v4BackfillsSnapshotOnlyFromMatchingExecutionJob() {
        migrateThroughV3();
        insertJob("job-snapshot", "java-initial-v1", "session-1", "user-1", "ontology-1",
                "property", "collection-rate-analysis", "{\"organizationId\":\"org-1\"}", null);
        insertSnapshot("job-snapshot", "session-1", "user-1", null, "ontology-1",
                "java-initial-v1", "{\"source\":\"legacy/unknown\"}");

        // Same execution id is not enough if the persisted ownership/version
        // context proves that the job is not the snapshot's source.
        insertJob("job-mismatch", "java-initial-v1", "other-session", "user-1", "ontology-1",
                "property", "collection-rate-analysis", "{\"organizationId\":\"org-1\"}", null);
        insertSnapshot("job-mismatch", "session-1", "user-1", null, "ontology-1",
                "java-initial-v1", "{\"source\":\"legacy/unknown\"}");

        // The binding itself carries the version proof; a nullable legacy
        // snapshot version must not prevent a safe same-execution backfill.
        insertJob("job-null-version", "java-initial-v1", "session-1", "user-1", "ontology-1",
                "property", "collection-rate-analysis", "{\"organizationId\":\"org-1\"}", null);
        insertSnapshot("job-null-version", "session-1", "user-1", null, null,
                "java-initial-v1", "{\"source\":\"legacy/unknown\"}");

        assertEquals(DatabaseMigrationService.Decision.MIGRATED_INCREMENTAL, service().run());
        assertEquals("property", jdbc.queryForObject(
                "select capability_binding->>'domainKey' from platform.analysis_execution_snapshots where execution_id='job-snapshot'",
                String.class));
        assertEquals("collection-rate-analysis", jdbc.queryForObject(
                "select capability_binding->>'capabilityKey' from platform.analysis_execution_snapshots where execution_id='job-snapshot'",
                String.class));
        assertEquals("legacy/unknown", jdbc.queryForObject(
                "select capability_binding->>'source' from platform.analysis_execution_snapshots where execution_id='job-mismatch'",
                String.class));
        assertEquals("property", jdbc.queryForObject(
                "select capability_binding->>'domainKey' from platform.analysis_execution_snapshots where execution_id='job-null-version'",
                String.class));
    }

    @Test
    void v4BackfillsFollowUpFromReferencedJobBeforeItsResultAndPreservesUnprovenRows() {
        migrateThroughV3();
        insertJob("root-job", "java-initial-v1", "session-1", "user-1", "ontology-follow-up",
                "property", "source-capability", "{\"organizationId\":\"org-1\"}", null);
        insertJob("result-job", "java-follow-up-v1", "session-1", "user-1", "ontology-follow-up",
                "property", "result-capability", "{\"organizationId\":\"org-1\"}", "follow-1");
        insertFollowUp("follow-1", "session-1", "user-1", "root-job", "result-job", null,
                "ontology-follow-up", "{\"source\":\"legacy/unknown\"}");

        // The referenced execution is not present, so a result execution can
        // be used only when it identifies this exact follow-up job.
        insertJob("result-only-job", "java-follow-up-v1", "session-1", "user-1", "ontology-result-only",
                "easyv", "generation-quality-analysis", "{\"userId\":\"123\",\"accessMode\":\"creator-owned\"}", "follow-2");
        insertFollowUp("follow-2", "session-1", "user-1", "missing-root", "result-only-job", null,
                "ontology-result-only", "{\"source\":\"legacy/unknown\"}");

        // A malformed result must not be treated as evidence for a binding.
        insertJob("malformed-result", "java-follow-up-v1", "session-1", "user-1", "ontology-bad",
                "easyv", "generation-quality-analysis", "{}", "follow-3");
        insertFollowUp("follow-3", "session-1", "user-1", "missing-root", "malformed-result", null,
                "ontology-bad", "{\"source\":\"legacy/unknown\"}");

        assertEquals(DatabaseMigrationService.Decision.MIGRATED_INCREMENTAL, service().run());
        assertEquals("source-capability", jdbc.queryForObject(
                "select capability_binding->>'capabilityKey' from platform.analysis_session_follow_ups where id='follow-1'",
                String.class));
        assertEquals("generation-quality-analysis", jdbc.queryForObject(
                "select capability_binding->>'capabilityKey' from platform.analysis_session_follow_ups where id='follow-2'",
                String.class));
        assertEquals("legacy/unknown", jdbc.queryForObject(
                "select capability_binding->>'source' from platform.analysis_session_follow_ups where id='follow-3'",
                String.class));
    }

    private void migrateThroughV3() {
        Flyway.configure().dataSource(jdbc.getDataSource()).locations("classpath:db/migration")
                .target("3").load().migrate();
    }

    private void insertJob(String id, String contract, String sessionId, String ownerUserId,
                           String ontologyVersionId, String domainKey, String capabilityKey,
                           String scopeValues, String followUpId) {
        String binding = "{\"domainKey\":\"" + domainKey + "\",\"capabilityKey\":\"" + capabilityKey
                + "\",\"ontologyVersionId\":\"" + ontologyVersionId + "\",\"resolvedScope\":{"
                + "\"domainKey\":\"" + domainKey + "\",\"schemaVersion\":1,\"values\":" + scopeValues + "}}";
        String payload = "{\"executionContract\":\"" + contract + "\",\"ontologyVersionId\":\""
                + ontologyVersionId + "\",\"capabilityBinding\":" + binding
                + (followUpId == null ? "" : ",\"followUpId\":\"" + followUpId + "\"") + "}";
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,attempt_count,max_attempts,available_at,dispatch_status,
                 owner_user_id,organization_id,session_id,origin_correlation_id,created_at,updated_at)
                values (?,'analysis-execution','completed',cast(? as jsonb),0,2,now(),'published',
                        ?, 'org-1', ?, ?, now(), now())
                """, id, payload, ownerUserId, sessionId, "trace-" + id);
    }

    private void insertSnapshot(String executionId, String sessionId, String ownerUserId, String followUpId,
                                String ontologyVersionId, String contract, String capabilityBinding) {
        jdbc.update("""
                insert into platform.analysis_execution_snapshots
                (execution_id,session_id,owner_user_id,follow_up_id,ontology_version_id,
                 ontology_version_binding_source,capability_binding,status,plan_snapshot,step_results,
                 conclusion_state,result_blocks,mobile_projection,created_at,updated_at)
                values (?,?,?,?,?,'grounded-context',cast(? as jsonb),'completed',cast(? as jsonb),
                        '[]','{}','[]','{}',now(),now())
                """, executionId, sessionId, ownerUserId, followUpId, ontologyVersionId,
                capabilityBinding, "{\"_executionContract\":\"" + contract + "\"}");
    }

    private void insertFollowUp(String id, String sessionId, String ownerUserId, String referencedExecutionId,
                                String resultExecutionId, String parentFollowUpId, String ontologyVersionId,
                                String capabilityBinding) {
        jdbc.update("""
                insert into platform.analysis_session_follow_ups
                (id,session_id,owner_user_id,question_text,parent_follow_up_id,referenced_execution_id,
                 referenced_conclusion_title,referenced_conclusion_summary,result_execution_id,
                 ontology_version_id,ontology_version_binding_source,capability_binding,inherited_context,
                 merged_context,created_at,updated_at)
                values (?,?,?,'继续分析',?,?, '结论','摘要',?,?, 'inherited',cast(? as jsonb),
                        '{}','{}',now(),now())
                """, id, sessionId, ownerUserId, parentFollowUpId, referencedExecutionId,
                resultExecutionId, ontologyVersionId, capabilityBinding);
    }
}
