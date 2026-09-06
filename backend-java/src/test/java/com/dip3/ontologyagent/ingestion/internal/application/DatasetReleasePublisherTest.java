package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DataProductInput;
import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatasetReleasePublisherTest {
    private static final Instant AT = Instant.parse("2026-09-05T00:00:00Z");

    private final SourceIngestionOrchestrator sourceIngestion = mock(SourceIngestionOrchestrator.class);
    private final SourceCatalogPort sourceCatalog = mock(SourceCatalogPort.class);
    private final ProductCatalogPort productCatalog = mock(ProductCatalogPort.class);
    private final ProductMaterializer materializer = mock(ProductMaterializer.class);
    private final IngestionPersistencePort persistence = mock(IngestionPersistencePort.class);
    private final DatasetReleasePublisher publisher = new DatasetReleasePublisher(
            sourceIngestion, sourceCatalog, productCatalog, materializer, persistence);

    @Test
    void publishesOneFrozenManifestAfterAllNamedProductsMaterialize() {
        when(sourceIngestion.ingest(any())).thenReturn(new SourceIngestionOrchestrator.Result(
                "source-run", List.of(sourceVersion("dataset-a", "source-a"),
                sourceVersion("dataset-b", "source-b"))));
        when(sourceCatalog.loadActiveSource("source-a")).thenReturn(sourceCatalog());
        when(productCatalog.loadActiveProduct("product-a")).thenReturn(product(
                "product-a", "input-a", "dataset-a", true));
        when(productCatalog.loadActiveProduct("product-b")).thenReturn(product(
                "product-b", "input-b", "dataset-b", true));
        when(materializer.materialize(any())).thenAnswer(invocation -> {
            ProductMaterializer.Command command = invocation.getArgument(0);
            return productVersion(command.productKey(), command.productVersionId());
        });
        when(persistence.freezeVersionSet(any())).thenAnswer(invocation -> {
            IngestionPersistencePort.VersionSetPublication publication = invocation.getArgument(0);
            return new DatasetVersionSet(publication.setId(), publication.productVersionIds(),
                    publication.capturedAt(), DatasetVersionSet.Status.FROZEN,
                    publication.capturedAt(), publication.capturedAt(), publication.createdBy());
        });

        DatasetReleasePublisher.Result result = publisher.publish(command());

        assertEquals("release-1", result.versionSet().publicationId());
        assertEquals(Set.of("product-a", "product-b"), result.productVersions().keySet());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<ProductMaterializer.Command> productCommand =
                ArgumentCaptor.forClass(ProductMaterializer.Command.class);
        verify(materializer, org.mockito.Mockito.times(2)).materialize(productCommand.capture());
        Map<String, Map<String, String>> inputs = productCommand.getAllValues().stream()
                .collect(java.util.stream.Collectors.toMap(ProductMaterializer.Command::productKey,
                        ProductMaterializer.Command::sourceVersionIds));
        assertEquals(Map.of("input-a", "source-a"), inputs.get("product-a"));
        assertEquals(Map.of("input-b", "source-b"), inputs.get("product-b"));
        ArgumentCaptor<IngestionPersistencePort.VersionSetPublication> publication =
                ArgumentCaptor.forClass(IngestionPersistencePort.VersionSetPublication.class);
        verify(persistence).freezeVersionSet(publication.capture());
        assertEquals(result.productVersions().entrySet().stream().collect(
                        java.util.stream.Collectors.toMap(Map.Entry::getKey,
                                entry -> entry.getValue().id())),
                publication.getValue().productVersionIds());
    }

    @Test
    void missingRequiredSourceDatasetNeverPublishesPartialProductsOrManifest() {
        when(sourceIngestion.ingest(any())).thenReturn(new SourceIngestionOrchestrator.Result(
                "source-run", List.of(sourceVersion("dataset-a", "source-a"))));
        when(sourceCatalog.loadActiveSource("source-a")).thenReturn(sourceCatalog());
        when(productCatalog.loadActiveProduct("product-a")).thenReturn(product(
                "product-a", "source", "dataset-missing", true));

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> publisher.publish(new DatasetReleasePublisher.Command(
                        "release-1", "source-a", Set.of("product-a"), IngestionRun.Mode.FULL,
                        IngestionRun.TriggerType.MANUAL, "operator", "trace", 100)));

        assertEquals("source release is missing required dataset: dataset-missing", error.getMessage());
        verify(materializer, never()).materialize(any());
        verify(persistence, never()).freezeVersionSet(any());
    }

    @Test
    void incrementalReleaseReusesCommittedHeadForDatasetNotInIncrementalRun() {
        when(sourceIngestion.ingest(any())).thenReturn(new SourceIngestionOrchestrator.Result(
                "source-run", List.of(sourceVersion("dataset-a", "source-a-new"))));
        when(sourceCatalog.loadActiveSource("source-a")).thenReturn(sourceCatalog(List.of(
                cursor("dataset-a", "source-a-new"),
                cursor("dataset-b", "source-b-existing"))));
        when(productCatalog.loadActiveProduct("product-a")).thenReturn(product(
                "product-a", "input-a", "dataset-a", true));
        when(productCatalog.loadActiveProduct("product-b")).thenReturn(product(
                "product-b", "input-b", "dataset-b", true));
        when(materializer.materialize(any())).thenAnswer(invocation -> {
            ProductMaterializer.Command productCommand = invocation.getArgument(0);
            return productVersion(productCommand.productKey(), productCommand.productVersionId());
        });
        when(persistence.freezeVersionSet(any())).thenAnswer(invocation -> {
            IngestionPersistencePort.VersionSetPublication publication = invocation.getArgument(0);
            return new DatasetVersionSet(publication.setId(), publication.productVersionIds(),
                    publication.capturedAt(), DatasetVersionSet.Status.FROZEN,
                    publication.capturedAt(), publication.capturedAt(), publication.createdBy());
        });

        publisher.publish(new DatasetReleasePublisher.Command(
                "release-2", "source-a", Set.of("product-a", "product-b"),
                IngestionRun.Mode.INCREMENTAL, IngestionRun.TriggerType.SCHEDULED,
                "scheduler", "trace-2", 100));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<ProductMaterializer.Command> commands =
                ArgumentCaptor.forClass(ProductMaterializer.Command.class);
        verify(materializer, org.mockito.Mockito.times(2)).materialize(commands.capture());
        Map<String, Map<String, String>> inputs = commands.getAllValues().stream()
                .collect(java.util.stream.Collectors.toMap(ProductMaterializer.Command::productKey,
                        ProductMaterializer.Command::sourceVersionIds));
        assertEquals(Map.of("input-a", "source-a-new"), inputs.get("product-a"));
        assertEquals(Map.of("input-b", "source-b-existing"), inputs.get("product-b"));
    }

    private static DatasetReleasePublisher.Command command() {
        return new DatasetReleasePublisher.Command(
                "release-1", "source-a", Set.of("product-b", "product-a"),
                IngestionRun.Mode.FULL, IngestionRun.TriggerType.MANUAL,
                "operator", "trace", 100);
    }

    private static DatasetVersion sourceVersion(String datasetKey, String id) {
        return new DatasetVersion(id, datasetKey, 1, DatasetVersion.Status.PUBLISHED,
                "source-run", null, Map.of("snapshot", "one"), Map.of("complete", true),
                "ingestion://source-dataset-version/" + id + "/row-pack-v1", 1,
                "a".repeat(64), 1, AT, AT);
    }

    private static ProductCatalogPort.ProductCatalog product(
            String productKey, String inputKey, String datasetKey, boolean required) {
        DataProductInput input = new DataProductInput(inputKey, datasetKey, 0, required,
                Map.of(), Map.of());
        DataProductDefinition product = new DataProductDefinition(productKey, "domain-a",
                "facts", productKey.replace('-', '_'), "transform-a", 1,
                Map.of(), DataProductDefinition.Status.ACTIVE, List.of(input), Map.of());
        DatasetDefinition dataset = new DatasetDefinition(datasetKey, "source-a", "public",
                datasetKey.replace('-', '_'), List.of(new DatasetDefinition.SourceColumn(
                "id", DatasetDefinition.ColumnType.STRING, false)), List.of("id"),
                new DatasetDefinition.CursorSpec(DatasetDefinition.CursorSpec.Strategy.SNAPSHOT,
                        null, null), DatasetDefinition.DeletePolicy.NONE,
                DatasetDefinition.DeletionSpec.none(), 1, DatasetDefinition.Status.ACTIVE, Map.of());
        return new ProductCatalogPort.ProductCatalog(product, Map.of(inputKey, dataset));
    }

    private static SourceCatalogPort.SourceCatalog sourceCatalog() {
        return sourceCatalog(List.of());
    }

    private static SourceCatalogPort.SourceCatalog sourceCatalog(List<IngestionCursor> cursors) {
        return new SourceCatalogPort.SourceCatalog(
                new SourceDefinition("source-a", "postgres", "source-a",
                        SourceDefinition.Status.ACTIVE),
                List.of(dataset("dataset-a"), dataset("dataset-b")), cursors);
    }

    private static IngestionCursor cursor(String datasetKey, String versionId) {
        return new IngestionCursor(datasetKey, Map.of("watermark", "2026-09-05T00:00:00Z"),
                versionId, AT);
    }

    private static DatasetDefinition dataset(String datasetKey) {
        return new DatasetDefinition(datasetKey, "source-a", "public",
                datasetKey.replace('-', '_'), List.of(new DatasetDefinition.SourceColumn(
                "id", DatasetDefinition.ColumnType.STRING, false)), List.of("id"),
                new DatasetDefinition.CursorSpec(DatasetDefinition.CursorSpec.Strategy.SNAPSHOT,
                        null, null), DatasetDefinition.DeletePolicy.NONE,
                DatasetDefinition.DeletionSpec.none(), 1, DatasetDefinition.Status.ACTIVE, Map.of());
    }

    private static DataProductVersion productVersion(String productKey, String id) {
        return new DataProductVersion(id, productKey, 1, DataProductVersion.Status.PUBLISHED,
                "run-" + productKey, 1, "facts." + productKey.replace('-', '_') + "@1",
                1, "b".repeat(64), AT, AT);
    }
}
