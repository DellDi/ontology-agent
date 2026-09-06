package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.DatasetVersionSetPostgresAdapter;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInfo;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Runtime-reader contract tests over the immutable EasyV canonical facts. */
@Testcontainers
class EasyVCanonicalFactAdapterTest {
    private static final String SET_ID = "easyv-set-1";
    private static final Instant SOURCE_CREATED_AT = Instant.parse("2026-08-01T00:00:00Z");
    private static final Instant SOURCE_PUBLISHED_AT = Instant.parse("2026-08-01T00:20:00Z");
    private static final Instant PRODUCT_CREATED_AT = Instant.parse("2026-08-01T00:30:00Z");
    private static final Instant PRODUCT_PUBLISHED_AT = Instant.parse("2026-08-01T02:50:00Z");
    private static final Instant CAPTURED_AT = Instant.parse("2026-08-01T03:00:00Z");
    private static final Instant OBSERVED_AT = Instant.parse("2026-08-01T02:00:00Z");
    private static final Timestamp APP_TIME = at("2026-08-01T01:00:00Z");
    private static final Timestamp PROTOTYPE_TIME = at("2026-08-01T01:10:00Z");
    private static final Timestamp PIPELINE_TIME = at("2026-08-01T01:30:00Z");
    private static final Timestamp FORGE_STARTED_AT = at("2026-08-01T01:30:00Z");
    private static final Timestamp FORGE_FINISHED_AT = at("2026-08-01T01:31:00Z");
    private static final Timestamp FORGE_CREATED_AT = at("2026-08-01T01:40:00Z");
    private static final Timestamp FEEDBACK_TIME = at("2026-08-01T02:00:00Z");
    private static final List<String> PRODUCTS = List.of(
            "easyv-ai-application",
            "easyv-prototype-task",
            "easyv-pipeline-node",
            "easyv-forge-task",
            "easyv-generation-feedback");
    private static final Map<String, String> PRODUCT_VERSIONS = Map.of(
            "easyv-ai-application", "product-easyv-ai-application",
            "easyv-prototype-task", "product-easyv-prototype-task",
            "easyv-pipeline-node", "product-easyv-pipeline-node",
            "easyv-forge-task", "product-easyv-forge-task",
            "easyv-generation-feedback", "product-easyv-generation-feedback");

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private JdbcTemplate jdbc;
    private DatasetVersionSetPostgresAdapter versionSets;
    private EasyVGenerationFacts reader;

    @BeforeAll
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @BeforeEach
    void resetArtifacts(TestInfo testInfo) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
                truncate facts.easyv_ai_application, facts.easyv_prototype_task,
                  facts.easyv_pipeline_node, facts.easyv_forge_generation_task,
                  facts.easyv_generation_feedback, ingestion.dataset_version_set_items,
                  ingestion.dataset_version_sets, ingestion.data_product_version_lineage,
                  ingestion.data_product_versions, ingestion.product_materialization_runs,
                  ingestion.dataset_cursors, ingestion.source_dataset_batches,
                  ingestion.source_dataset_versions, ingestion.source_ingestion_runs cascade
                """);
        Fixture fixture = fixtureFor(testInfo);
        seedCanonicalFacts(fixture);
        versionSets = new DatasetVersionSetPostgresAdapter(jdbc, new JsonCodec());
        JdbcTransactionManager transactions = new JdbcTransactionManager(dataSource);
        transactions.setEnforceReadOnly(true);
        reader = new EasyVCanonicalFactAdapter(jdbc, transactions, versionSets);
    }

    @Test
    void collectsOnlyCreatorFactsFromTheExactFrozenVersionSet() {
        assertEquals(PRODUCT_VERSIONS,
                versionSets.requireFrozen(SET_ID, EasyVCanonicalFactAdapter.REQUIRED_PRODUCTS)
                        .productVersionIds());

        EasyVGenerationFacts.Snapshot snapshot = reader.collect(query("1"));

        assertEquals(1, snapshot.application().applicationCount());
        assertEquals(1, snapshot.application().prototypeCount());
        assertEquals(1, snapshot.pipeline().taskCount());
        assertEquals(1, snapshot.pipeline().completedTaskCount());
        assertEquals(0, snapshot.pipeline().failedTaskCount());
        assertEquals(2, snapshot.pipeline().mainNodeCount());
        assertEquals(2, snapshot.pipeline().timedNodeCount());
        assertEquals(100, snapshot.pipeline().bottleneckP95Millis());
        assertEquals(2, snapshot.forge().taskCount());
        assertEquals(1, snapshot.forge().completedTaskCount());
        assertEquals(1, snapshot.forge().failedTaskCount());
        assertEquals(2, snapshot.forge().terminalTaskCount());
        assertEquals(2, snapshot.forge().timedTerminalTaskCount());
        assertEquals(60_000, snapshot.forge().p50DurationMillis());
        assertEquals(60_000, snapshot.forge().p95DurationMillis());
        assertEquals(2, snapshot.feedback().operationCount());
        assertEquals(1, snapshot.feedback().combinedExecuteSuccessCount());
        assertEquals(1, snapshot.feedback().combinedExecuteFailureCount());
        assertEquals(1, snapshot.forge().failureReasonCounts().size());
        assertTrue(snapshot.forge().failureReasonCounts().keySet().stream()
                .allMatch(key -> key.startsWith("md5:")));
        assertEquals("1", snapshot.application().window().userId());
        assertEquals(CAPTURED_AT, snapshot.application().window().freshnessAt());
        assertTrue(EasyVCanonicalFactAdapter.TIME_SEMANTICS.get("forge")
                .contains("facts.easyv_forge_generation_task.created_at"));
    }

    @Test
    void partialPipelineDurationIsAllowedAndCoverageIsExposed() {
        EasyVGenerationFacts.Snapshot snapshot = reader.collect(query("1"));

        assertEquals(2, snapshot.pipeline().mainNodeCount());
        assertEquals(1, snapshot.pipeline().timedNodeCount());
        assertEquals(100, snapshot.pipeline().bottleneckP95Millis());
    }

    @Test
    void allPipelineDurationMissingFailsLoudlyInsteadOfReturningZero() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1")));

        assertEquals("EASYV_FACTS_DURATION_MISSING", error.code());
    }

    @Test
    void incompleteForgeTaskFailsLoudly() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1")));

        assertEquals("EASYV_FACTS_INCOMPLETE", error.code());
    }

    @Test
    void partialForgeDurationIsAllowedAndCoverageIsExposed() {
        EasyVGenerationFacts.Snapshot snapshot = reader.collect(query("1"));

        assertEquals(2, snapshot.forge().terminalTaskCount());
        assertEquals(1, snapshot.forge().timedTerminalTaskCount());
        assertEquals(60_000, snapshot.forge().p50DurationMillis());
        assertEquals(60_000, snapshot.forge().p95DurationMillis());
    }

    @Test
    void allForgeDurationMissingFailsLoudlyInsteadOfReturningZero() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1")));

        assertEquals("EASYV_FACTS_DURATION_MISSING", error.code());
    }

    @Test
    void legalCreatorWithEmptyDateWindowGetsExplicitEmptyCode() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1", LocalDate.of(2025, 1, 1),
                        LocalDate.of(2025, 1, 1))));

        assertEquals("EASYV_FACTS_EMPTY", error.code());
    }

    @Test
    void orphanFeedbackIsRejectedInsteadOfEscapingCreatorCohort() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1")));

        assertEquals("EASYV_FACTS_INCOMPLETE", error.code());
    }

    @Test
    void pipelineSuccessFailureConflictIsExplicitlyRejected() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1")));

        assertEquals("EASYV_FACTS_TASK_CONFLICT", error.code());
    }

    @Test
    void futureFactInSelectedCohortIsRejectedWithFutureDataCode() {
        BackendException error = assertThrows(BackendException.class,
                () -> reader.collect(query("1", LocalDate.of(2026, 8, 2),
                        LocalDate.of(2026, 8, 2))));

        assertEquals("EASYV_FACTS_FUTURE_DATA", error.code());
    }

    @Test
    void deletedApplicationTombstonesAreRetainedButExcludedFromActiveCohort() {
        EasyVGenerationFacts.Snapshot snapshot = reader.collect(query("1"));

        assertEquals(1, snapshot.application().applicationCount());
        assertEquals(1, snapshot.application().prototypeCount());
        assertEquals(1, snapshot.pipeline().taskCount());
        assertEquals(2, snapshot.forge().taskCount());
        assertEquals(2, snapshot.feedback().operationCount());
        assertEquals(1L, jdbc.queryForObject("""
                select count(*) from facts.easyv_ai_application
                where product_version_id=? and is_deleted
                """, Long.class, PRODUCT_VERSIONS.get("easyv-ai-application")));
    }

    private Fixture fixtureFor(TestInfo testInfo) {
        String name = testInfo.getTestMethod().orElseThrow().getName();
        return switch (name) {
            case "partialPipelineDurationIsAllowedAndCoverageIsExposed" -> Fixture.PARTIAL_PIPELINE;
            case "allPipelineDurationMissingFailsLoudlyInsteadOfReturningZero" ->
                    Fixture.ALL_PIPELINE_DURATION_MISSING;
            case "incompleteForgeTaskFailsLoudly" -> Fixture.INCOMPLETE_FORGE;
            case "partialForgeDurationIsAllowedAndCoverageIsExposed" -> Fixture.PARTIAL_FORGE;
            case "allForgeDurationMissingFailsLoudlyInsteadOfReturningZero" ->
                    Fixture.ALL_FORGE_DURATION_MISSING;
            case "orphanFeedbackIsRejectedInsteadOfEscapingCreatorCohort" -> Fixture.ORPHAN_FEEDBACK;
            case "pipelineSuccessFailureConflictIsExplicitlyRejected" -> Fixture.PIPELINE_CONFLICT;
            case "futureFactInSelectedCohortIsRejectedWithFutureDataCode" -> Fixture.FUTURE_FACT;
            case "deletedApplicationTombstonesAreRetainedButExcludedFromActiveCohort" ->
                    Fixture.DELETED_APPLICATION;
            default -> Fixture.BASELINE;
        };
    }

    private void seedCanonicalFacts(Fixture fixture) {
        insertSourceArtifacts();
        insertProductVersions();
        insertApplications();
        insertPrototypes();
        insertPipeline(fixture);
        insertForge(fixture);
        insertFeedback(fixture);
        insertScenarioFacts(fixture);
        publishProductVersions();
        freezeVersionSet();
    }

    private void insertSourceArtifacts() {
        jdbc.update("""
                insert into ingestion.source_ingestion_runs
                  (id,source_key,mode,status,trigger_type,triggered_by,correlation_id,
                   snapshot_context,row_counts,started_at,finished_at,created_at,updated_at)
                values (?,'easyv','full','completed','bootstrap','test','canonical-reader-test',
                        cast(? as jsonb),cast(? as jsonb),?,?,?,?)
                """, "source-run-1", "{\"snapshot\":\"one\"}", "{}",
                at(SOURCE_CREATED_AT), at(SOURCE_PUBLISHED_AT), at(SOURCE_CREATED_AT),
                at(SOURCE_PUBLISHED_AT));
        for (String product : PRODUCTS) {
            String version = "source-" + product;
            jdbc.update("""
                    insert into ingestion.source_dataset_versions
                      (id,source_key,dataset_key,source_ingestion_run_id,version_number,
                       storage_ref,source_watermark,committed_cursor,row_count,content_hash,
                       schema_version,status,published_at,created_at)
                    values (?,'easyv',?,'source-run-1',1,?,cast(? as jsonb),cast(? as jsonb),
                            1,?,1,'published',?,?)
                    """, version, product,
                    "ingestion://source-dataset-version/" + version + "/row-pack-v1",
                    "{\"snapshot\":\"one\"}",
                    "{}", "source-hash-" + product, at(SOURCE_PUBLISHED_AT),
                    at(SOURCE_CREATED_AT));
        }
    }

    private void insertProductVersions() {
        for (String product : PRODUCTS) {
            String run = "product-run-" + product;
            String version = PRODUCT_VERSIONS.get(product);
            jdbc.update("""
                    insert into ingestion.product_materialization_runs
                      (id,product_key,mode,status,trigger_type,triggered_by,correlation_id,
                       input_summary,row_counts,started_at,finished_at,created_at,updated_at)
                    values (?,?,'full','completed','bootstrap','test',?,cast(? as jsonb),
                            cast(? as jsonb),?,?,?,?)
                    """, run, product, "canonical-reader-test", "{}", "{}",
                    at(PRODUCT_CREATED_AT), at(PRODUCT_PUBLISHED_AT), at(PRODUCT_CREATED_AT),
                    at(PRODUCT_PUBLISHED_AT));
            jdbc.update("""
                    insert into ingestion.data_product_versions
                      (id,product_key,materialization_run_id,version_number,storage_ref,
                       row_count,content_hash,schema_version,status,published_at,created_at)
                    values (?,?,?,1,null,1,null,1,'building',null,?)
                    """, version, product, run, at(PRODUCT_CREATED_AT));
        }
    }

    private void insertApplications() {
        insertApplication(1, "app-1", "java-task-1", APP_TIME);
        insertApplication(2, "app-2", "java-task-2", APP_TIME);
    }

    private void insertApplication(long sourceId, String appId, String taskId, Timestamp createdAt) {
        insertApplication(sourceId, appId, taskId, createdAt, false);
    }

    private void insertApplication(long sourceId, String appId, String taskId, Timestamp createdAt,
                                   boolean deleted) {
        jdbc.update("""
                insert into facts.easyv_ai_application
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   app_id,generation_task_id,user_id,space_id,team_id,scope_type,
                   created_at,updated_at,is_deleted)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, PRODUCT_VERSIONS.get("easyv-ai-application"), "easyv-ai-application",
                "source-easyv-ai-application", sourceId, appId, taskId,
                sourceId == 1 || sourceId == 3 ? 1 : 2,
                sourceId == 1 || sourceId == 3 ? 11 : 22,
                sourceId == 1 || sourceId == 3 ? 111 : 222,
                sourceId == 1 || sourceId == 3 ? "USER" : "TEAM",
                createdAt, createdAt, deleted);
    }

    private void insertPrototypes() {
        insertPrototype(1, "app-1");
        insertPrototype(2, "app-2");
    }

    private void insertPrototype(long sourceId, String appId) {
        jdbc.update("""
                insert into facts.easyv_prototype_task
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   app_id,created_at,updated_at)
                values (?,?,?,?,?,?,?)
                """, PRODUCT_VERSIONS.get("easyv-prototype-task"), "easyv-prototype-task",
                "source-easyv-prototype-task", sourceId, appId, PROTOTYPE_TIME, PROTOTYPE_TIME);
    }

    private void insertPipeline(Fixture fixture) {
        Long completedDuration = fixture == Fixture.ALL_PIPELINE_DURATION_MISSING ? null : 100L;
        Long stepDuration = switch (fixture) {
            case PARTIAL_PIPELINE -> null;
            case ALL_PIPELINE_DURATION_MISSING -> null;
            default -> 100L;
        };
        insertPipelineNode(1, "java-task-1", "PipelineCompleted", "SUCCESS", completedDuration);
        insertPipelineNode(2, "java-task-1", "Step1", "SUCCESS", stepDuration);
        insertPipelineNode(3, "java-task-2", "PipelineCompleted", "SUCCESS", 900L);
    }

    private void insertPipelineNode(long sourceId, String taskId, String stepName,
                                    String status, Long duration) {
        jdbc.update("""
                insert into facts.easyv_pipeline_node
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   task_id,step_name,branch,status,duration_ms,created_at)
                values (?,?,?,?,?,?,?,?,?,?)
                """, PRODUCT_VERSIONS.get("easyv-pipeline-node"), "easyv-pipeline-node",
                "source-easyv-pipeline-node", sourceId, taskId, stepName, "MAIN", status,
                duration, PIPELINE_TIME);
    }

    private void insertForge(Fixture fixture) {
        String status = fixture == Fixture.INCOMPLETE_FORGE ? "running" : "completed";
        Timestamp firstStarted = fixture == Fixture.PARTIAL_FORGE
                || fixture == Fixture.ALL_FORGE_DURATION_MISSING ? null : FORGE_STARTED_AT;
        Timestamp secondStarted = fixture == Fixture.ALL_FORGE_DURATION_MISSING
                ? null : FORGE_STARTED_AT;
        Timestamp firstFinished = fixture == Fixture.PARTIAL_FORGE
                || fixture == Fixture.ALL_FORGE_DURATION_MISSING ? null : FORGE_FINISHED_AT;
        Timestamp secondFinished = fixture == Fixture.ALL_FORGE_DURATION_MISSING
                ? null : FORGE_FINISHED_AT;
        insertForgeTask(UUID.fromString("00000000-0000-0000-0000-000000000001"),
                "forge-task-1", "app-1", status, "d41d8cd98f00b204e9800998ecf8427e",
                firstStarted, firstFinished);
        insertForgeTask(UUID.fromString("00000000-0000-0000-0000-000000000002"),
                "forge-task-2", "app-1", "failed", "9e107d9d372bb6826bd81d3542a419d6",
                secondStarted, secondFinished);
        insertForgeTask(UUID.fromString("00000000-0000-0000-0000-000000000003"),
                "forge-task-3", "app-2", "completed", "098f6bcd4621d373cade4e832627b4f6",
                FORGE_STARTED_AT, FORGE_FINISHED_AT);
    }

    private void insertForgeTask(UUID sourceId, String taskId, String appId, String status,
                                 String failureHash, Timestamp startedAt, Timestamp finishedAt) {
        jdbc.update("""
                insert into facts.easyv_forge_generation_task
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   task_id,app_id,status,failure_reason_hash,started_at,finished_at,
                   created_at,updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?)
                """, PRODUCT_VERSIONS.get("easyv-forge-task"), "easyv-forge-task",
                "source-easyv-forge-task", sourceId, taskId, appId, status, failureHash,
                startedAt, finishedAt, FORGE_CREATED_AT, FORGE_CREATED_AT);
    }

    private void insertFeedback(Fixture fixture) {
        insertFeedback(1, 1, "app-1", 1, 5, true);
        insertFeedback(2, 1, "app-1", 0, 3, false);
        insertFeedback(3, 2, "app-2", 1, 1, true);
    }

    private void insertFeedback(long sourceId, long userId, String appId, int executeResult,
                                int rating, boolean saveAsEdit) {
        jdbc.update("""
                insert into facts.easyv_generation_feedback
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   space_id,user_id,operated_at,ai_action_type,execute_result,rating,
                   app_id,task_id,is_save_as_edit)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, PRODUCT_VERSIONS.get("easyv-generation-feedback"),
                "easyv-generation-feedback", "source-easyv-generation-feedback", sourceId,
                userId == 1 ? 11 : 22, userId, FEEDBACK_TIME, "generate", executeResult,
                rating, appId, null, saveAsEdit);
    }

    private void insertScenarioFacts(Fixture fixture) {
        if (fixture == Fixture.ORPHAN_FEEDBACK) {
            insertFeedback(99, 1, "missing-app", 1, 4, false);
        }
        if (fixture == Fixture.PIPELINE_CONFLICT) {
            insertPipelineNode(99, "java-task-1", "FailureAfterSuccess", "FAILED", 50L);
        }
        if (fixture == Fixture.FUTURE_FACT) {
            jdbc.update("""
                    insert into facts.easyv_ai_application
                      (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                       app_id,generation_task_id,user_id,space_id,team_id,scope_type,
                       created_at,updated_at,is_deleted)
                    values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, PRODUCT_VERSIONS.get("easyv-ai-application"), "easyv-ai-application",
                    "source-easyv-ai-application", 99, "future-app", "future-java-task",
                    1, 11, 111, "USER", at("2026-08-02T04:00:00Z"),
                    at("2026-08-02T04:00:00Z"), false);
        }
        if (fixture == Fixture.DELETED_APPLICATION) {
            insertApplication(3, "app-deleted", "java-task-deleted", APP_TIME, true);
            insertPrototype(3, "app-deleted");
            insertPipelineNode(4, "java-task-deleted", "PipelineCompleted", "SUCCESS", 900L);
            insertForgeTask(UUID.fromString("00000000-0000-0000-0000-000000000099"),
                    "forge-task-deleted", "app-deleted", "completed",
                    "098f6bcd4621d373cade4e832627b4f6", FORGE_STARTED_AT, FORGE_FINISHED_AT);
            insertFeedback(4, 1, "app-deleted", 1, 5, true);
        }
    }

    private void publishProductVersions() {
        for (String product : PRODUCTS) {
            jdbc.update("""
                    update ingestion.data_product_versions
                    set status='published',storage_ref=?,content_hash=?,published_at=?
                    where id=?
                    """, "db://" + PRODUCT_VERSIONS.get(product),
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                    at(PRODUCT_PUBLISHED_AT), PRODUCT_VERSIONS.get(product));
        }
    }

    private void freezeVersionSet() {
        jdbc.update("""
                insert into ingestion.dataset_version_sets
                  (set_id,status,captured_at,frozen_at,created_by,created_at)
                values (?,'frozen',?,?,?,?)
                """, SET_ID, at(CAPTURED_AT), at(CAPTURED_AT.plusSeconds(1)), "test",
                at(CAPTURED_AT));
        for (String product : PRODUCTS) {
            jdbc.update("""
                    insert into ingestion.dataset_version_set_items
                      (set_id,product_key,product_version_id)
                    values (?,?,?)
                    """, SET_ID, product, PRODUCT_VERSIONS.get(product));
        }
    }

    private EasyVGenerationFacts.Query query(String userId) {
        return query(userId, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 1));
    }

    private EasyVGenerationFacts.Query query(String userId, LocalDate from, LocalDate to) {
        return new EasyVGenerationFacts.Query("execution-1", userId, "creator-owned", "ontology-1",
                SET_ID, from, to, OBSERVED_AT);
    }

    private static Timestamp at(Instant instant) {
        return Timestamp.from(instant);
    }

    private static Timestamp at(String instant) {
        return at(Instant.parse(instant));
    }

    private enum Fixture {
        BASELINE,
        PARTIAL_PIPELINE,
        ALL_PIPELINE_DURATION_MISSING,
        INCOMPLETE_FORGE,
        PARTIAL_FORGE,
        ALL_FORGE_DURATION_MISSING,
        ORPHAN_FEEDBACK,
        PIPELINE_CONFLICT,
        FUTURE_FACT,
        DELETED_APPLICATION
    }
}
