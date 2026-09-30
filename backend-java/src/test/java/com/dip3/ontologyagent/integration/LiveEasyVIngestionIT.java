package com.dip3.ontologyagent.integration;

import com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion.EasyVCanonicalTransform;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.IngestionPostgresPersistenceAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.DatasetVersionSetPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.ProductCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.SourceCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres.PostgresSourceConnector;
import com.dip3.ontologyagent.ingestion.internal.application.CanonicalProductTransformRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.DatasetReleasePublisher;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.ProductMaterializer;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnectorRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.SourceIngestionOrchestrator;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Explicit live gate: real EasyV source in a forced read-only transaction to a disposable
 * PostgreSQL platform database. It is included only by the {@code live-integration} profile.
 */
@Testcontainers
class LiveEasyVIngestionIT {
    private static final List<String> DATASET_KEYS = List.of(
            "easyv-ai-application",
            "easyv-prototype-task",
            "easyv-pipeline-node",
            "easyv-forge-task",
            "easyv-generation-feedback");

    private static final Set<String> PRODUCT_KEYS = EasyVOntologyModel.OBJECTS.stream()
            .map(object -> object.productKey()).collect(Collectors.toSet());

    private static final Map<String, String> SOURCE_RELATIONS = Map.of(
            "easyv-ai-application", "easyv_saas.ai_screen_app",
            "easyv-prototype-task", "easyv_saas.ai_screen_prototype",
            "easyv-pipeline-node", "easyv_saas.ai_pipeline_node_record",
            "easyv-forge-task", "easyv_saas.generation_tasks",
            "easyv-generation-feedback", "easyv_saas.dt_ai_operation_log");

    private static final Map<String, String> FACT_RELATIONS = Map.of(
            "easyv-ai-application", "facts.easyv_ai_application",
            "easyv-prototype-task", "facts.easyv_prototype_task",
            "easyv-pipeline-node", "facts.easyv_pipeline_node",
            "easyv-forge-task", "facts.easyv_forge_generation_task",
            "easyv-generation-feedback", "facts.easyv_generation_feedback");

    @Container
    static final PostgreSQLContainer TARGET = new PostgreSQLContainer("postgres:17.8-alpine");

    @BeforeAll
    static void migrateTarget() {
        required("EASYV_POSTGRES_JDBC_URL");
        required("EASYV_POSTGRES_USERNAME");
        required("EASYV_POSTGRES_PASSWORD");
        MigrationTestSupport.migrate(TARGET);
    }

    @Test
    void ingestsFiveSourcesAndEightProductsWithStableIncrementalAndReconcileResults() {
        DataSource sourceDataSource = new DriverManagerDataSource(
                required("EASYV_POSTGRES_JDBC_URL"),
                required("EASYV_POSTGRES_USERNAME"),
                required("EASYV_POSTGRES_PASSWORD"));
        JdbcTransactionManager sourceTransactions = new JdbcTransactionManager(sourceDataSource);
        sourceTransactions.setEnforceReadOnly(true);
        JdbcTemplate sourceJdbc = new JdbcTemplate(sourceDataSource);

        Map<String, Long> sourceCountsBefore = readOnly(sourceTransactions,
                () -> sourceCounts(sourceJdbc));
        Map<String, Long> sourceDistributionsBefore = readOnly(sourceTransactions,
                () -> sourceDistributions(sourceJdbc));

        DataSource targetDataSource = new DriverManagerDataSource(
                TARGET.getJdbcUrl(), TARGET.getUsername(), TARGET.getPassword());
        JdbcTemplate targetJdbc = new JdbcTemplate(targetDataSource);
        JdbcTransactionManager targetTransactions = new JdbcTransactionManager(targetDataSource);
        JsonCodec json = new JsonCodec();
        RowPackV1Codec codec = new RowPackV1Codec();
        IngestionPersistencePort persistence = new IngestionPostgresPersistenceAdapter(
                targetJdbc, json, targetTransactions);
        SourceCatalogPostgresAdapter sourceCatalog = new SourceCatalogPostgresAdapter(
                targetJdbc, json);

        PostgresSourceConnectionProvider provider = connectionRef -> {
            assertEquals("easyv-source", connectionRef);
            return new PostgresSourceConnectionProvider.ResolvedConnection(
                    sourceDataSource, sourceTransactions, 30);
        };
        SourceIngestionOrchestrator orchestrator = new SourceIngestionOrchestrator(
                sourceCatalog,
                new SourceConnectorRegistry(List.of(new PostgresSourceConnector(provider))),
                codec,
                persistence);

        String execution = UUID.randomUUID().toString();
        List<CanonicalProductTransform> transforms = Arrays.stream(
                        EasyVCanonicalTransform.Kind.values())
                .map(kind -> (CanonicalProductTransform) new EasyVCanonicalTransform(
                        kind, targetJdbc, json))
                .toList();
        ProductMaterializer materializer = new ProductMaterializer(
                new ProductCatalogPostgresAdapter(targetJdbc, json, sourceCatalog),
                new CanonicalProductTransformRegistry(transforms),
                codec,
                persistence);
        String setId = "live-easyv-set-" + execution;
        DatasetReleasePublisher publisher = new DatasetReleasePublisher(
                orchestrator,
                sourceCatalog,
                new ProductCatalogPostgresAdapter(targetJdbc, json, sourceCatalog),
                materializer,
                persistence);
        DatasetReleasePublisher.Result release = publisher.publish(new DatasetReleasePublisher.Command(
                setId, "easyv", PRODUCT_KEYS,
                IngestionRun.Mode.FULL, IngestionRun.TriggerType.MANUAL,
                "live-integration", "live-easyv-" + execution, 2_000));
        Map<String, DatasetVersion> versions = release.sourceVersions();
        assertEquals(DATASET_KEYS.stream().sorted().toList(),
                versions.keySet().stream().sorted().toList());
        DATASET_KEYS.forEach(datasetKey -> assertEquals(
                sourceCountsBefore.get(datasetKey), versions.get(datasetKey).rowCount(),
                "source artifact row count for " + datasetKey));
        DatasetVersionSetPostgresAdapter versionSets = new DatasetVersionSetPostgresAdapter(
                targetJdbc, json);
        assertEquals(setId, versionSets.latestFrozen(
                PRODUCT_KEYS).orElseThrow().publicationId());

        for (String datasetKey : DATASET_KEYS) {
            assertEquals(sourceCountsBefore.get(datasetKey),
                    targetJdbc.queryForObject(
                            "select count(*) from " + FACT_RELATIONS.get(datasetKey), Long.class),
                    "canonical fact row count for " + datasetKey);
        }
        assertEquals(sourceDistributionsBefore, targetDistributions(targetJdbc));
        assertEquals((long) PRODUCT_KEYS.size(), targetJdbc.queryForObject(
                "select count(*) from ingestion.data_product_versions where status='published'",
                Long.class));
        assertEquals((long) PRODUCT_KEYS.size(), targetJdbc.queryForObject(
                "select count(*) from ingestion.data_product_version_lineage", Long.class));
        assertEquals(1L, targetJdbc.queryForObject(
                "select count(*) from ingestion.dataset_version_sets where status='frozen'",
                Long.class));
        assertEquals(sourceCountsBefore.get("easyv-prototype-task"), targetJdbc.queryForObject(
                "select count(*) from facts.easyv_prototype_layout", Long.class));
        List<Long> parsedIds = targetJdbc.queryForList(
                "select source_id from facts.easyv_prototype_layout where parse_status='ok'", Long.class);
        Map<String, Long> structure = readOnly(sourceTransactions,
                () -> sourceStructureCounts(sourceJdbc, parsedIds));
        assertEquals(structure.get("blocks"), targetJdbc.queryForObject(
                "select count(*) from facts.easyv_prototype_block", Long.class));
        assertEquals(structure.get("components"), targetJdbc.queryForObject(
                "select count(*) from facts.easyv_prototype_component", Long.class));
        System.out.println("LIVE_EASYV_STRUCTURE source=" + sourceCountsBefore.get("easyv-prototype-task")
                + " parsed=" + parsedIds.size() + " structure=" + structure
                + " statuses=" + targetJdbc.queryForList(
                    "select parse_status,parse_error_code,count(*) from facts.easyv_prototype_layout group by 1,2"));

        for (IngestionRun.Mode mode : List.of(IngestionRun.Mode.INCREMENTAL, IngestionRun.Mode.RECONCILE)) {
            DatasetReleasePublisher.Result next = publisher.publish(new DatasetReleasePublisher.Command(
                    setId + "-" + mode, "easyv", PRODUCT_KEYS, mode, IngestionRun.TriggerType.MANUAL,
                    "live-integration", "live-easyv-" + execution + "-" + mode, 2_000));
            for (String product : PRODUCT_KEYS) {
                assertEquals(release.productVersions().get(product).contentHash(),
                        next.productVersions().get(product).contentHash(), mode + " content for " + product);
                assertEquals(release.productVersions().get(product).rowCount(),
                        next.productVersions().get(product).rowCount(), mode + " count for " + product);
            }
        }

        Map<String, Long> sourceCountsAfter = readOnly(sourceTransactions,
                () -> sourceCounts(sourceJdbc));
        Map<String, Long> sourceDistributionsAfter = readOnly(sourceTransactions,
                () -> sourceDistributions(sourceJdbc));
        assertEquals(sourceCountsBefore, sourceCountsAfter,
                "EasyV source changed during the live snapshot; rerun against a stable interval");
        assertEquals(sourceDistributionsBefore, sourceDistributionsAfter,
                "EasyV source distributions changed during the live snapshot; rerun against a stable interval");
    }

    // 独立 SQL 只从源 JSON 展开统计；不调用生产解析器。解析失败的源记录不应产出子事实。
    private static Map<String, Long> sourceStructureCounts(JdbcTemplate jdbc, List<Long> parsedIds) {
        if (parsedIds.isEmpty()) return Map.of("blocks", 0L, "components", 0L);
        String placeholders = String.join(",", java.util.Collections.nCopies(parsedIds.size(), "?"));
        Map<String, Object> counts = jdbc.queryForMap("""
                select count(*) as blocks,
                  coalesce(sum(jsonb_array_length(coalesce(block.value->'components','[]'::jsonb))),0) as components
                from easyv_saas.ai_screen_prototype p
                cross join lateral jsonb_each(p.screen_prototype_json) page
                cross join lateral jsonb_each(page.value->'blocks') block
                where page.key like 'page-%%' and p.id in (%s)
                """.formatted(placeholders), parsedIds.toArray());
        return Map.of("blocks", ((Number) counts.get("blocks")).longValue(),
                "components", ((Number) counts.get("components")).longValue());
    }

    private static Map<String, Long> sourceCounts(JdbcTemplate jdbc) {
        Map<String, Long> counts = new LinkedHashMap<>();
        DATASET_KEYS.forEach(datasetKey -> counts.put(datasetKey, jdbc.queryForObject(
                "select count(*) from " + SOURCE_RELATIONS.get(datasetKey), Long.class)));
        return Map.copyOf(counts);
    }

    private static Map<String, Long> sourceDistributions(JdbcTemplate jdbc) {
        Map<String, Long> result = new LinkedHashMap<>();
        result.put("application.deleted", jdbc.queryForObject(
                "select count(*) from easyv_saas.ai_screen_app where is_delete='1'", Long.class));
        addDistribution(result, "forge.status", jdbc.queryForList("""
                select status::text as value, count(*) as count
                from easyv_saas.generation_tasks group by status::text
                """));
        addDistribution(result, "feedback.result", jdbc.queryForList("""
                select execute_result::text as value, count(*) as count
                from easyv_saas.dt_ai_operation_log group by execute_result
                """));
        addDistribution(result, "feedback.rating", jdbc.queryForList("""
                select coalesce(rating::text, '<null>') as value, count(*) as count
                from easyv_saas.dt_ai_operation_log group by rating
                """));
        return Map.copyOf(result);
    }

    private static Map<String, Long> targetDistributions(JdbcTemplate jdbc) {
        Map<String, Long> result = new LinkedHashMap<>();
        result.put("application.deleted", jdbc.queryForObject(
                "select count(*) from facts.easyv_ai_application where is_deleted", Long.class));
        addDistribution(result, "forge.status", jdbc.queryForList("""
                select status as value, count(*) as count
                from facts.easyv_forge_generation_task group by status
                """));
        addDistribution(result, "feedback.result", jdbc.queryForList("""
                select execute_result::text as value, count(*) as count
                from facts.easyv_generation_feedback group by execute_result
                """));
        addDistribution(result, "feedback.rating", jdbc.queryForList("""
                select coalesce(rating::text, '<null>') as value, count(*) as count
                from facts.easyv_generation_feedback group by rating
                """));
        return Map.copyOf(result);
    }

    private static void addDistribution(Map<String, Long> target, String prefix,
                                        List<Map<String, Object>> rows) {
        for (Map<String, Object> row : rows) {
            target.put(prefix + "." + row.get("value"), ((Number) row.get("count")).longValue());
        }
    }

    private static <T> T readOnly(JdbcTransactionManager transactions,
                                  java.util.function.Supplier<T> action) {
        TransactionTemplate template = new TransactionTemplate(transactions);
        template.setReadOnly(true);
        return template.execute(status -> action.get());
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("真实 EasyV ingestion 验证缺少环境变量 " + name);
        }
        return value.trim();
    }
}
