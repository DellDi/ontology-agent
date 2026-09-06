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
import com.dip3.ontologyagent.easyv.internal.adapter.out.postgres.EasyVCanonicalFactAdapter;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
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
                    Map.of("source", sourceVersions.get(productKey))));
            productVersions.put(productKey, published.id());
        }

        Instant capturedAt = Instant.now();
        persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(
                "easyv-set-1", productVersions, capturedAt, "test"));
        DatasetVersionSetPostgresAdapter versionSets = new DatasetVersionSetPostgresAdapter(jdbc, json);
        assertEquals("easyv-set-1", versionSets.latestFrozen(
                EasyVCanonicalFactAdapter.REQUIRED_PRODUCTS).orElseThrow().publicationId());
        EasyVGenerationFacts.Snapshot snapshot = new EasyVCanonicalFactAdapter(
                jdbc, new JdbcTransactionManager(jdbc.getDataSource()), versionSets).collect(
                new EasyVGenerationFacts.Query("execution-1", "11", "creator-owned",
                        "ontology-1", "easyv-set-1", LocalDate.of(2026, 9, 4),
                        LocalDate.of(2026, 9, 4), Instant.now()));

        assertEquals(1L, count("facts.easyv_ai_application"));
        assertEquals(1L, count("facts.easyv_prototype_task"));
        assertEquals(1L, count("facts.easyv_pipeline_node"));
        assertEquals(1L, count("facts.easyv_forge_generation_task"));
        assertEquals(1L, count("facts.easyv_generation_feedback"));
        assertEquals(5L, count("ingestion.data_product_versions"));
        assertEquals(5L, count("ingestion.data_product_version_lineage"));
        assertEquals(1L, snapshot.application().applicationCount());
        assertEquals(1L, snapshot.application().prototypeCount());
        assertEquals(1L, snapshot.pipeline().completedTaskCount());
        assertEquals(1L, snapshot.forge().completedTaskCount());
        assertEquals(1L, snapshot.feedback().combinedExecuteSuccessCount());
        assertEquals(false, jdbc.queryForObject(
                "select is_deleted from facts.easyv_ai_application", Boolean.class));
        assertEquals("completed", jdbc.queryForObject(
                "select status from facts.easyv_forge_generation_task", String.class));
        assertEquals("d41d8cd98f00b204e9800998ecf8427e", jdbc.queryForObject(
                "select failure_reason_hash from facts.easyv_forge_generation_task", String.class));
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

    private Map<String, String> publishSourceSnapshot() {
        List<DatasetDefinition> datasets = sourceCatalog.loadActiveSource("easyv").datasets();
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

    private static SourceRow sourceRow(String datasetKey) {
        LocalDateTime created = LocalDateTime.parse("2026-09-04T09:00:00");
        LocalDateTime updated = LocalDateTime.parse("2026-09-04T09:05:00");
        return switch (datasetKey) {
            case "easyv-ai-application" -> row(1L, "app-1", "pipeline-task-1",
                    11L, 22L, 33L, "user", created, updated, "0");
            case "easyv-prototype-task" -> row(2L, "app-1", created, updated);
            case "easyv-pipeline-node" -> row(3L, "pipeline-task-1",
                    "PipelineCompleted", "MAIN", "SUCCESS", 120L, created);
            case "easyv-forge-task" -> row(UUID.fromString(
                            "00000000-0000-0000-0000-000000000004"),
                    "forge-task-1", "app-1", "completed", null,
                    created, updated, created, updated);
            case "easyv-generation-feedback" -> row(5L, 22L, 11L,
                    Instant.parse("2026-09-04T01:00:00Z"), "generate", 1, 5,
                    "app-1", null, true);
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
