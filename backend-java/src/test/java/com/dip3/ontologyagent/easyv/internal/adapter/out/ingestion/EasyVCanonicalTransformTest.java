package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.IngestionPostgresPersistenceAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.DatasetVersionSetPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.ProductCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.SourceCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.application.CanonicalProductTransformRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.ProductMaterializer;
import com.dip3.ontologyagent.ingestion.internal.application.SourceBatchManifest;
import com.dip3.ontologyagent.ingestion.internal.application.SourceCatalogPort;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** End-to-end evidence for all five reviewed EasyV source-to-facts mappings. */
@Testcontainers
class EasyVCanonicalTransformTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private JdbcTemplate jdbc;
    private IngestionPersistencePort persistence;
    private RowPackV1Codec codec;
    private SourceCatalogPort sourceCatalog;

    @BeforeAll
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @BeforeEach
    void resetArtifacts() {
        DataSource dataSource = new DriverManagerDataSource(
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
        JsonCodec json = new JsonCodec();
        persistence = new IngestionPostgresPersistenceAdapter(
                jdbc, json, new JdbcTransactionManager(dataSource));
        codec = new RowPackV1Codec();
        sourceCatalog = new SourceCatalogPostgresAdapter(jdbc, json);
    }

    @Test
    void scoreSnapshotsAreWhitelistedReproducibleAndVersionedWhenMutableSourceContextChanges() {
        String source = publishPipeline("score-first", scoreOutput("metric-a"), 3, "PipelineCompleted");
        String first = materializePipeline("score-first", source);
        String repeated = materializePipeline("score-repeat", source, "version-easyv-generation-feedback-score-first");
        assertEquals(pipelineHash(first), pipelineHash(repeated));
        String snapshot = jdbc.queryForObject("select score_snapshot::text from facts.easyv_pipeline_node where product_version_id=?",
                String.class, first);
        assertTrue(snapshot.contains("mutable_regen_context"));
        assertTrue(snapshot.contains("145.5"));
        assertTrue(snapshot.contains("metric-a"));
        assertFalse(snapshot.contains("不应保留"));
        assertEquals("available_unverified", jdbc.queryForObject(
                "select score_snapshot_status from facts.easyv_pipeline_node where product_version_id=?", String.class, first));
        assertEquals(3, jdbc.queryForObject("select schema_version from ingestion.data_product_versions where id=?", Integer.class, first));
        String changed = materializePipeline("score-edited", publishPipeline("score-edited", scoreOutput("metric-edited"), 3, "PipelineCompleted"));
        assertNotEquals(pipelineHash(first), pipelineHash(changed), "源端原行的 create_time 不变，RECONCILE 仍捕获快照编辑");
        assertEquals("metric-a", jdbc.queryForObject("""
                select score_snapshot #>> '{filledBlocks,0,bindings,0,metricId}'
                from facts.easyv_pipeline_node where product_version_id=?
                """, String.class, first));
        assertEquals("metric-edited", jdbc.queryForObject("""
                select score_snapshot #>> '{filledBlocks,0,bindings,0,metricId}'
                from facts.easyv_pipeline_node where product_version_id=?
                """, String.class, changed));
        assertThrows(DataAccessException.class, () -> jdbc.update("update facts.easyv_pipeline_node set score_snapshot=null where product_version_id=?", first));
        assertEquals("easyv-pipeline-node-v3", jdbc.queryForObject(
                "select transform_ref from ingestion.data_product_version_lineage where product_version_id=? and input_key='source'", String.class, first));
    }

    @Test
    void missingAndInvalidScoreSnapshotsRemainLocatableWithoutDroppingPipelineFacts() {
        String missing = materializePipeline("score-missing", publishPipeline("score-missing", null, 3, "PipelineCompleted"));
        assertEquals("missing", jdbc.queryForObject("select score_snapshot_status from facts.easyv_pipeline_node where product_version_id=?", String.class, missing));
        assertEquals("PIPELINE_OUTPUT_MISSING", jdbc.queryForObject("select score_snapshot_error_code from facts.easyv_pipeline_node where product_version_id=?", String.class, missing));
        Object malformed = Map.of("output", Map.of("raw", List.of("wrong-shape")));
        String invalid = materializePipeline("score-invalid", publishPipeline("score-invalid", malformed, 3, "PipelineCompleted"));
        assertEquals("invalid", jdbc.queryForObject("select score_snapshot_status from facts.easyv_pipeline_node where product_version_id=?", String.class, invalid));
        assertEquals("SCORE_OBJECT_INVALID", jdbc.queryForObject("select score_snapshot_error_code from facts.easyv_pipeline_node where product_version_id=?", String.class, invalid));
        assertNull(jdbc.queryForObject("select score_snapshot::text from facts.easyv_pipeline_node where product_version_id=?", String.class, invalid));
        String other = materializePipeline("score-other", publishPipeline("score-other", malformed, 3, "Step6"));
        assertEquals("not_applicable", jdbc.queryForObject("select score_snapshot_status from facts.easyv_pipeline_node where product_version_id=?", String.class, other));
        assertEquals(3L, count("facts.easyv_pipeline_node"));
    }

    @Test
    void scoreMaterializationRejectsTheOldSourceSchemaBeforeDecoding() {
        jdbc.update("update ingestion.dataset_definitions set schema_version=1,column_contract=column_contract - 9 - 8 - 7 where dataset_key='easyv-pipeline-node'");
        String source;
        try {
            source = publishPipeline("score-v1", null, 1, "PipelineCompleted");
        } finally {
            jdbc.update("""
                    update ingestion.dataset_definitions set schema_version=3,
                    column_contract=column_contract || '[{"name":"output","type":"JSON","nullable":true},{"name":"session_id","type":"STRING","nullable":true},{"name":"intent","type":"STRING","nullable":true}]'::jsonb
                    where dataset_key='easyv-pipeline-node'
                    """);
        }
        var error = assertThrows(IllegalArgumentException.class, () -> materializePipeline("score-v1", source));
        assertEquals("source version chain does not match dataset contract", error.getMessage());
        assertEquals("failed", jdbc.queryForObject("select status from ingestion.product_materialization_runs where id='pipeline-run-score-v1'", String.class));
        assertEquals(0L, count("facts.easyv_pipeline_node"));
    }

    private String publishPipeline(String suffix, Object output, int schemaVersion, String step) {
        LocalDateTime created = LocalDateTime.parse("2026-09-04T09:00:00");
        SourceRow node = schemaVersion == 1
                ? row(3L, "pipeline-task-1", step, "MAIN", "SUCCESS", 120L, created)
                : row(3L, "pipeline-task-1", step, "MAIN", "SUCCESS", 120L, created, output, "session-1", null);
        String version = publishRows("easyv-pipeline-node", suffix, List.of(node));
        publishRows("easyv-generation-feedback", suffix, List.of(sourceRow("easyv-generation-feedback")));
        return version;
    }

    private String publishRows(String key, String suffix, List<SourceRow> rows) {
        DatasetDefinition dataset = sourceCatalog.loadActiveSource("easyv").datasets().stream()
                .filter(d -> d.datasetKey().equals(key)).findFirst().orElseThrow();
        String run = "source-" + key + "-" + suffix;
        String version = "version-" + key + "-" + suffix;
        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(run, "easyv", IngestionRun.Mode.RECONCILE,
                IngestionRun.TriggerType.BOOTSTRAP, "test", "trace-" + suffix, Map.of("snapshot", suffix)));
        persistence.startSourceRun(run);
        persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(run, List.of(
                new IngestionPersistencePort.SourceDatasetReservation(version, key, null, Map.of("snapshot", suffix), dataset.schemaVersion()))));
        var receipt = persistence.appendSourceBatch(new IngestionPersistencePort.SourceBatchAppend(version, 1, rows.size(), codec.encode(dataset, rows)));
        persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(run, List.of(
                new IngestionPersistencePort.SourceDatasetPublication(key, 1, rows.size(),
                        SourceBatchManifest.aggregate(List.of(receipt)).contentHash(), Map.of("complete", true)))));
        return version;
    }

    private String materializePipeline(String suffix, String source) {
        return materializePipeline(suffix, source, "version-easyv-generation-feedback-" + suffix);
    }

    private String materializePipeline(String suffix, String source, String operations) {
        JsonCodec json = new JsonCodec();
        ProductMaterializer materializer = new ProductMaterializer(new ProductCatalogPostgresAdapter(jdbc, json, sourceCatalog),
                new CanonicalProductTransformRegistry(List.of(new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PIPELINE, jdbc, json))), codec, persistence);
        return materializer.materialize(new ProductMaterializer.Command("pipeline-run-" + suffix, "easyv-pipeline-node", "pipeline-product-" + suffix,
                ProductMaterializationRun.Mode.FULL, ProductMaterializationRun.TriggerType.BOOTSTRAP,
                "test", "trace-" + suffix, Map.of("source", source, "operations", operations))).id();
    }

    private String pipelineHash(String version) {
        return jdbc.queryForObject("select content_hash from ingestion.data_product_versions where id=?", String.class, version);
    }

    private static Object scoreOutput(String metricId) {
        return Map.of("output", Map.of("raw", Map.of("regenContextSnapshot", Map.of(
                "originalTaskId", "pipeline-task-1", "originalSceneDescription", "不应保留的用户问题",
                "step5Candidates", Map.of("step4Output", Map.of("blockAssignments", List.of(Map.of(
                        "blockId", "block-1", "bestSchemeId", "4", "matchScore", 145.5, "bestSchemeScore", 95.5,
                        "businessModule", "不应保留的模块标题")))),
                "currentFilledBlocks", List.of(Map.of("blockId", "block-1", "selectedScheme", Map.of("schemeId", "7"),
                        "slotBindings", List.of(Map.of("slotIndex", 0, "chartType", "折线图", "desc", "不应保留的描述",
                                "boundMetric", Map.of("metricId", metricId, "metricName", "不应保留的指标名")))))))));
    }

    @Test
    void materializesFiveTypedProductsWithVersionedLineageAndSensitiveHashing() {
        Map<String, String> sourceVersions = publishSourceSnapshot();
        JsonCodec json = new JsonCodec();
        List<CanonicalProductTransform> transforms = Arrays.stream(EasyVCanonicalTransform.Kind.values())
                .map(kind -> (CanonicalProductTransform) new EasyVCanonicalTransform(kind, jdbc, json))
                .toList();
        ProductMaterializer materializer = new ProductMaterializer(
                new ProductCatalogPostgresAdapter(jdbc, json, sourceCatalog),
                new CanonicalProductTransformRegistry(transforms), codec, persistence);

        Map<String, String> productVersions = new LinkedHashMap<>();
        for (String productKey : sourceVersions.keySet()) {
            var published = materializer.materialize(new ProductMaterializer.Command(
                    "product-run-" + productKey, productKey, "product-version-" + productKey,
                    ProductMaterializationRun.Mode.FULL,
                    ProductMaterializationRun.TriggerType.BOOTSTRAP,
                    "test", "trace-" + productKey,
                    inputs(productKey, sourceVersions)));
            productVersions.put(productKey, published.id());
        }

        Instant capturedAt = Instant.now();
        persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(
                "easyv-set-1", productVersions, capturedAt, "test"));
        DatasetVersionSetPostgresAdapter versionSets = new DatasetVersionSetPostgresAdapter(jdbc, json);
        assertEquals("easyv-set-1", versionSets.latestFrozen(
                EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS).orElseThrow().publicationId());

        assertEquals(1L, count("facts.easyv_ai_application"));
        assertEquals(1L, count("facts.easyv_prototype_task"));
        assertEquals(1L, count("facts.easyv_pipeline_node"));
        assertEquals(1L, count("facts.easyv_forge_generation_task"));
        assertEquals(1L, count("facts.easyv_generation_feedback"));
        assertEquals(5L, count("ingestion.data_product_versions"));
        assertEquals(6L, count("ingestion.data_product_version_lineage"));
        assertEquals(1L, jdbc.queryForObject(
                "select count(*) from facts.easyv_pipeline_task where outcome='completed'", Long.class));
        assertEquals(1L, jdbc.queryForObject(
                "select count(*) from facts.easyv_forge_generation_task where status='failed'", Long.class));
        assertEquals(1L, jdbc.queryForObject(
                "select count(*) from facts.easyv_generation_feedback where execute_result=1", Long.class));
        assertEquals(false, jdbc.queryForObject(
                "select is_deleted from facts.easyv_ai_application", Boolean.class));
        assertEquals("failed", jdbc.queryForObject(
                "select status from facts.easyv_forge_generation_task", String.class));
        assertTrue(jdbc.queryForObject(
                "select failure_reason_hash from facts.easyv_forge_generation_task", String.class)
                .matches("[0-9a-f]{32}"));
        assertEquals("page-1: agent invoke threw: Recursion limit of 25 reached",
                jdbc.queryForObject(
                        "select failure_reason from facts.easyv_forge_generation_task",
                        String.class));
        assertNull(jdbc.queryForObject(
                "select task_id from facts.easyv_generation_feedback", String.class));
        assertEquals(Instant.parse("2026-09-04T01:00:00Z"), jdbc.queryForObject(
                "select operated_at from facts.easyv_generation_feedback",
                (result, row) -> result.getTimestamp(1).toInstant()));
        assertTrue(jdbc.queryForList(
                        "select content_hash from ingestion.data_product_versions", String.class)
                .stream().allMatch(hash -> hash.matches("[0-9a-f]{64}")));
        assertThrows(DataAccessException.class, () -> jdbc.update(
                "update facts.easyv_ai_application set scope_type='changed'"));
    }

    @Test
    void rawTextIsOnlyReadableInAuthorizedDetailsAndNeverInListsFiltersOrCube() {
        Map<String, String> sources = publishSourceSnapshot();
        JsonCodec json = new JsonCodec();
        var materializer = new ProductMaterializer(new ProductCatalogPostgresAdapter(jdbc, json, sourceCatalog),
                new CanonicalProductTransformRegistry(Arrays.stream(EasyVCanonicalTransform.Kind.values())
                        .map(kind -> (CanonicalProductTransform) new EasyVCanonicalTransform(kind, jdbc, json)).toList()), codec, persistence);
        Map<String, String> versions = new LinkedHashMap<>();
        for (String key : sources.keySet()) {
            versions.put(key, materializer.materialize(new ProductMaterializer.Command("quality-run-" + key, key,
                    "quality-version-" + key, ProductMaterializationRun.Mode.FULL,
                    ProductMaterializationRun.TriggerType.BOOTSTRAP, "test", "quality-test", inputs(key, sources))).id());
        }
        var model = com.dip3.ontologyagent.semantic.api.SemanticModel.discover();
        var objects = new com.dip3.ontologyagent.semantic.internal.adapter.out.postgres.PostgresObjectQueryAdapter(jdbc, model);
        var access = new com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext(versions,
                com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope.everything());
        String key = "easyv-generation-feedback";
        var listed = objects.query(new com.dip3.ontologyagent.semantic.api.ObjectQueryPort.Query(key, null, null, 20, 0), access);
        assertFalse(listed.rows().getFirst().properties().containsKey("userInput"));
        var detail = objects.require(key, "5", access);
        assertEquals("用户真实诉求", detail.properties().get("userInput"));
        assertEquals(false, detail.properties().get("userInputTruncated"));
        assertEquals("源端失败原因", detail.properties().get("failureReason"));
        var other = new com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext(versions,
                com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope.restricted(Map.of("userId", List.of("999"))));
        assertThrows(com.dip3.ontologyagent.support.BackendException.class, () -> objects.require(key, "5", other));
        var filter = new com.dip3.ontologyagent.semantic.api.QueryIntent.Filter("userInput",
                com.dip3.ontologyagent.semantic.api.QueryIntent.Operator.CONTAINS, List.of("诉求"));
        assertThrows(com.dip3.ontologyagent.support.BackendException.class, () -> objects.query(
                new com.dip3.ontologyagent.semantic.api.ObjectQueryPort.Query(key, List.of(filter), null, 20, 0), access));
        assertThrows(com.dip3.ontologyagent.support.BackendException.class, () -> objects.query(
                new com.dip3.ontologyagent.semantic.api.ObjectQueryPort.Query(key, null,
                    List.of(new com.dip3.ontologyagent.semantic.api.QueryIntent.Order("userInput",
                        com.dip3.ontologyagent.semantic.api.QueryIntent.Direction.ASC)), 20, 0), access));
        String yaml = com.dip3.ontologyagent.semantic.api.CubeModelGenerator.generate(model).get("model/easyv/EasyvFeedback.yml");
        assertFalse(yaml.contains("name: \"userInput\""));
        var intent = new com.dip3.ontologyagent.semantic.api.QueryIntent(key, List.of("count"), List.of("userInput"), List.of(),
                new com.dip3.ontologyagent.semantic.api.QueryIntent.TimeSpec(null,
                    new com.dip3.ontologyagent.semantic.api.TimeExpression("全部", com.dip3.ontologyagent.semantic.api.TimeExpression.Kind.ALL,
                        null, null, null, null, null, null), null), null, List.of(), null);
        assertFalse(new com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler(model).compile(intent, Instant.now()).violations().isEmpty());
        assertEquals(2, jdbc.queryForObject("select schema_version from ingestion.data_product_versions where id=?", Integer.class, versions.get(key)));
    }

    @Test
    void qualityNodesKeepMultipleIntentsAndTextTruncationIsExplicit() {
        var sources = new LinkedHashMap<>(publishSourceSnapshot());
        String original = "😀".repeat(4001);
        String operations = publishRows("easyv-generation-feedback", "multi", List.of(row(51L, 22L, 11L,
                Instant.parse("2026-09-04T01:00:00Z"), "chatRefactor", 1, null, "app-1", "round-1", false, original, "失败".repeat(3000))));
        LocalDateTime time = LocalDateTime.parse("2026-09-04T09:00:00");
        String nodes = publishRows("easyv-pipeline-node", "multi", List.of(
                row(61L, "round-1", "ChatExecution", "CHAT", "SUCCESS", null, time,
                    Map.of("blockId", "left_1"), "chat-session", "BLOCK_ADD_METRIC"),
                row(62L, "round-1", "ChatExecution", "CHAT", "FAILED", null, time,
                    Map.of(), "chat-session", "BLOCK_REPLACE_TITLE")));
        JsonCodec json = new JsonCodec();
        var materializer = new ProductMaterializer(new ProductCatalogPostgresAdapter(jdbc, json, sourceCatalog),
                new CanonicalProductTransformRegistry(Arrays.stream(EasyVCanonicalTransform.Kind.values())
                    .map(kind -> (CanonicalProductTransform) new EasyVCanonicalTransform(kind, jdbc, json)).toList()), codec, persistence);
        sources.put("easyv-generation-feedback", operations);
        sources.put("easyv-pipeline-node", nodes);
        Map<String, String> versions = new LinkedHashMap<>();
        for (String key : List.of("easyv-ai-application", "easyv-generation-feedback", "easyv-pipeline-node")) {
            versions.put(key, materializer.materialize(new ProductMaterializer.Command("multi-run-" + key, key,
                    "multi-version-" + key, ProductMaterializationRun.Mode.FULL, ProductMaterializationRun.TriggerType.BOOTSTRAP,
                    "test", "multi-test", inputs(key, sources))).id());
        }
        var model = com.dip3.ontologyagent.semantic.api.SemanticModel.discover();
        var objects = new com.dip3.ontologyagent.semantic.internal.adapter.out.postgres.PostgresObjectQueryAdapter(jdbc, model);
        var access = new com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext(versions,
                com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope.everything());
        var operation = objects.require("easyv-generation-feedback", "51", access);
        String text = (String) operation.properties().get("userInput");
        assertEquals(4000, text.codePointCount(0, text.length()));
        assertEquals(true, operation.properties().get("userInputTruncated"));
        assertEquals(true, operation.properties().get("failureReasonTruncated"));
        String expectedHash = java.util.HexFormat.of().formatHex(digest(original));
        assertEquals(expectedHash, operation.properties().get("userInputHash"));
        var related = objects.related("easyv-generation-feedback", "51", "qualityNodes",
                new com.dip3.ontologyagent.semantic.api.ObjectQueryPort.Query("easyv-quality-node", null, null, 20, 0), access);
        assertEquals(2, related.rows().size());
        assertEquals(List.of("BLOCK_ADD_METRIC", "BLOCK_REPLACE_TITLE"), related.rows().stream().map(r -> r.properties().get("intent")).toList());
        assertEquals("left_1", related.rows().getFirst().properties().get("targetBlockId"));
        assertNull(related.rows().getLast().properties().get("targetBlockId"));
        assertTrue(related.rows().stream().allMatch(r -> "app-1".equals(r.properties().get("appId"))));
        var differentAccount = new com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext(versions,
                com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope.restricted(Map.of("userId", List.of("999"))));
        assertThrows(com.dip3.ontologyagent.support.BackendException.class, () -> objects.require("easyv-quality-node", "61", differentAccount));
    }

    private static byte[] digest(String text) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new AssertionError(e); }
    }

    private Map<String, String> publishSourceSnapshot() {
        List<DatasetDefinition> datasets = sourceCatalog.loadActiveSource("easyv").datasets().stream()
                .filter(d -> EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS.contains(d.datasetKey())).toList();
        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                "easyv-source-run", "easyv", IngestionRun.Mode.FULL,
                IngestionRun.TriggerType.BOOTSTRAP, "test", "trace-easyv-source",
                Map.of("connector", "test", "snapshot", "one")));
        persistence.startSourceRun("easyv-source-run");

        Map<String, String> versionIds = new LinkedHashMap<>();
        persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(
                "easyv-source-run", datasets.stream().map(dataset -> {
                    String versionId = "source-version-" + dataset.datasetKey();
                    versionIds.put(dataset.datasetKey(), versionId);
                    return new IngestionPersistencePort.SourceDatasetReservation(
                            versionId, dataset.datasetKey(), null,
                            Map.of("snapshot", "one"), dataset.schemaVersion());
                }).toList()));

        List<IngestionPersistencePort.SourceDatasetPublication> publications = new ArrayList<>();
        for (DatasetDefinition dataset : datasets) {
            byte[] payload = codec.encode(dataset, List.of(sourceRow(dataset.datasetKey())));
            IngestionPersistencePort.SourceBatchReceipt receipt = persistence.appendSourceBatch(
                    new IngestionPersistencePort.SourceBatchAppend(
                            versionIds.get(dataset.datasetKey()), 1, 1, payload));
            SourceBatchManifest.Aggregate aggregate = SourceBatchManifest.aggregate(List.of(receipt));
            publications.add(new IngestionPersistencePort.SourceDatasetPublication(
                    dataset.datasetKey(), 1, 1, aggregate.contentHash(), Map.of("complete", true)));
        }
        persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(
                "easyv-source-run", publications));
        return Collections.unmodifiableMap(versionIds);
    }

    private static Map<String, String> inputs(String product, Map<String, String> sources) {
        return product.equals("easyv-pipeline-node")
                ? Map.of("source", sources.get(product), "operations", sources.get("easyv-generation-feedback"))
                : Map.of("source", sources.get(product));
    }

    private static SourceRow sourceRow(String datasetKey) {
        LocalDateTime created = LocalDateTime.parse("2026-09-04T09:00:00");
        LocalDateTime updated = LocalDateTime.parse("2026-09-04T09:05:00");
        return switch (datasetKey) {
            case "easyv-ai-application" -> row(1L, "app-1", "pipeline-task-1",
                    11L, 22L, 33L, "user", created, updated, "0");
            case "easyv-prototype-task" -> row(2L, "app-1", null, null, created, updated);
            case "easyv-pipeline-node" -> row(3L, "pipeline-task-1",
                    "PipelineCompleted", "MAIN", "SUCCESS", 120L, created, null, "session-1", null);
            case "easyv-forge-task" -> row(UUID.fromString(
                            "00000000-0000-0000-0000-000000000004"),
                    "forge-task-1", "app-1", "failed",
                    Map.of("kind", "unknown",
                            "message", "page-1: agent invoke threw: Recursion limit of 25 reached"),
                    created, updated, created, updated);
            case "easyv-generation-feedback" -> row(5L, 22L, 11L,
                    Instant.parse("2026-09-04T01:00:00Z"), "generate", 1, 5,
                    "app-1", null, true, "用户真实诉求", "源端失败原因");
            default -> throw new IllegalArgumentException("unexpected dataset " + datasetKey);
        };
    }

    private static SourceRow row(Object... values) {
        return new SourceRow(Collections.unmodifiableList(Arrays.asList(values)));
    }

    private long count(String relation) {
        return jdbc.queryForObject("select count(*) from " + relation, Long.class);
    }
}
