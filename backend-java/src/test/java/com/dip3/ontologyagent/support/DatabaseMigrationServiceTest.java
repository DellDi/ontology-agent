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
        jdbc.execute("drop schema if exists platform cascade");
        jdbc.execute("drop schema if exists erp_staging cascade");
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
        assertEquals(4, applied, "新库应依次执行 V1 初始化、V2 Job binding、V3 snapshot/follow-up columns 与 V4 binding backfill");
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
        Integer platformTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'platform'", Integer.class);
        assertTrue(platformTables >= 20, "初始化应建齐 platform 业务表");
        Integer erpTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'erp_staging'", Integer.class);
        assertTrue(erpTables >= 9, "初始化应建齐 erp_staging 表");
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
        assertEquals(4, executed, "重复执行不得重跑已完成的 migration");
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
        assertEquals(5, foreignKeys, "重复执行不应产生重复外键约束");
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
        assertEquals(4, applied, "旧库补全应记录 V1、V2、V3 与 V4（baseline 0 标记不计入）");
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
