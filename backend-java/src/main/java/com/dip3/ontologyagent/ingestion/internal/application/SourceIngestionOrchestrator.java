package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.SourcePage;
import com.dip3.ontologyagent.ingestion.api.SourceSnapshot;
import com.dip3.ontologyagent.support.BackendException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** Executes one governed source snapshot from catalog lookup through atomic publication. */
public final class SourceIngestionOrchestrator {
    private static final Pattern SPOOL_DATASET_KEY = Pattern.compile("[a-z][a-z0-9_-]*");

    private final SourceCatalogPort catalog;
    private final SourceConnectorRegistry connectors;
    private final SourceBatchCodec codec;
    private final IngestionPersistencePort persistence;

    public SourceIngestionOrchestrator(SourceCatalogPort catalog,
                                       SourceConnectorRegistry connectors,
                                       SourceBatchCodec codec,
                                       IngestionPersistencePort persistence) {
        this.catalog = Objects.requireNonNull(catalog, "catalog must not be null");
        this.connectors = Objects.requireNonNull(connectors, "connectors must not be null");
        this.codec = Objects.requireNonNull(codec, "codec must not be null");
        this.persistence = Objects.requireNonNull(persistence, "persistence must not be null");
        if (!IngestionPersistencePort.ROW_PACK_CODEC.equals(codec.codec())) {
            throw new IllegalArgumentException("source batch codec must be row-pack-v1");
        }
    }

    public Result ingest(Command command) {
        Objects.requireNonNull(command, "command must not be null");
        SourceCatalogPort.SourceCatalog registration = catalog.loadActiveSource(command.sourceKey());
        SourceConnector connector = connectors.require(registration.source().connectorType());
        List<DatasetDefinition> datasets = registration.datasets().stream()
                .filter(dataset -> command.mode() != IngestionRun.Mode.INCREMENTAL
                        || dataset.cursorSpec().strategy()
                        == DatasetDefinition.CursorSpec.Strategy.WATERMARK)
                .sorted(Comparator.comparing(DatasetDefinition::datasetKey)).toList();
        if (datasets.isEmpty()) {
            throw new IllegalArgumentException("source has no dataset eligible for "
                    + command.mode().name().toLowerCase() + " ingestion");
        }
        var selectedDatasetKeys = datasets.stream().map(DatasetDefinition::datasetKey)
                .collect(java.util.stream.Collectors.toSet());
        List<IngestionCursor> committedCursors = registration.committedCursors().stream()
                .filter(cursor -> selectedDatasetKeys.contains(cursor.datasetKey())).toList();
        Map<String, IngestionCursor> cursorsByDataset = committedCursors.stream()
                .collect(java.util.stream.Collectors.toMap(IngestionCursor::datasetKey,
                        cursor -> cursor));
        boolean runExists = false;
        String stage = "create-run";
        String currentDataset = null;
        Map<String, Object> snapshotContext = null;
        Path spoolDirectory = null;
        List<Path> spoolFiles = new ArrayList<>();
        RuntimeException failure = null;
        boolean spoolCleaned = false;

        try {
            stage = "create-run";
            IngestionRun run = persistence.createSourceRun(
                    new IngestionPersistencePort.SourceRunRequest(
                            command.runId(), command.sourceKey(), command.mode(),
                            command.triggerType(), command.triggeredBy(), command.correlationId(),
                            IngestionPersistencePort.PLANNED_SOURCE_SNAPSHOT_CONTEXT));
            runExists = true;
            stage = "start-run";
            persistence.startSourceRun(run.id());

            stage = "create-spool";
            spoolDirectory = createSpoolDirectory();
            List<DatasetSpoolState> spooled = new ArrayList<>();
            stage = "open-source-snapshot";
            try (SourceSnapshot snapshot = connector.openSnapshot(registration.source(), datasets,
                    committedCursors, command.mode(), command.pageSize())) {
                snapshotContext = Map.copyOf(snapshot.snapshotContext());
                for (DatasetDefinition dataset : datasets) {
                    currentDataset = dataset.datasetKey();
                    stage = "read-source-page";
                    SourcePage page = snapshot.readPage(dataset.datasetKey());
                    List<SpoolBatch> batches = new ArrayList<>();
                    long batchNumber = 1;
                    Map<String, Object> committedCursor = page.nextCursor();
                    while (true) {
                        requirePageDataset(page, dataset.datasetKey());
                        if (!page.rows().isEmpty()) {
                            stage = "encode-source-batch";
                            byte[] payload = codec.encode(dataset, page.rows());
                            Path spoolFile = spoolPath(spoolDirectory, dataset.datasetKey(), batchNumber);
                            spoolFiles.add(spoolFile);
                            stage = "spool-source-batch";
                            writeSpoolBatch(spoolFile, payload, dataset.datasetKey(), batchNumber);
                            batches.add(new SpoolBatch(batchNumber++, page.rows().size(), spoolFile));
                        }
                        committedCursor = page.nextCursor();
                        if (page.lastPage()) break;
                        stage = "read-source-page";
                        page = snapshot.readPage(dataset.datasetKey(), page.nextCursor());
                    }
                    spooled.add(new DatasetSpoolState(dataset.datasetKey(), batches, committedCursor));
                }
            }

            currentDataset = null;
            stage = "record-source-snapshot-context";
            persistence.recordSourceSnapshotContext(command.runId(), snapshotContext);
            Map<String, Object> observedSnapshotContext = snapshotContext;
            stage = "reserve-source-versions";
            List<DatasetVersion> versions = persistence.reserveSourceVersions(
                    new IngestionPersistencePort.SourceVersionReservation(command.runId(),
                            datasets.stream().map(dataset ->
                                    new IngestionPersistencePort.SourceDatasetReservation(
                                            versionId(command.runId(), dataset.datasetKey()),
                                            dataset.datasetKey(), parentVersionId(
                                                    command.mode(), cursorsByDataset.get(
                                                            dataset.datasetKey())),
                                            observedSnapshotContext,
                                            dataset.schemaVersion())).toList()));
            Map<String, DatasetVersion> versionsByDataset = indexVersions(versions);
            List<DatasetPublicationState> states = new ArrayList<>();

            for (DatasetSpoolState spool : spooled) {
                currentDataset = spool.datasetKey();
                DatasetVersion version = versionsByDataset.get(spool.datasetKey());
                if (version == null) {
                    throw new IllegalStateException("reserved version missing for dataset "
                            + spool.datasetKey());
                }
                List<IngestionPersistencePort.SourceBatchReceipt> receipts = new ArrayList<>();
                for (SpoolBatch batch : spool.batches()) {
                    stage = "read-spooled-source-batch";
                    byte[] payload = readSpoolBatch(batch.path(), spool.datasetKey(), batch.batchNumber());
                    stage = "append-source-batch";
                    receipts.add(persistence.appendSourceBatch(
                            new IngestionPersistencePort.SourceBatchAppend(
                                    version.id(), batch.batchNumber(), batch.rowCount(), payload)));
                }
                SourceBatchManifest.Aggregate aggregate = SourceBatchManifest.aggregate(receipts);
                states.add(new DatasetPublicationState(spool.datasetKey(), aggregate,
                        spool.committedCursor()));
            }

            currentDataset = null;
            stage = "cleanup-spool";
            cleanupSpool(spoolDirectory, spoolFiles, null);
            spoolCleaned = true;
            stage = "publish-source-snapshot";
            List<DatasetVersion> published = persistence.publishSourceSnapshot(
                    new IngestionPersistencePort.SourcePublication(command.runId(), states.stream()
                            .map(state -> new IngestionPersistencePort.SourceDatasetPublication(
                                    state.datasetKey(), state.aggregate().batchCount(),
                                    state.aggregate().rowCount(), state.aggregate().contentHash(),
                            state.committedCursor())).toList()));
            return new Result(command.runId(), published);
        } catch (RuntimeException error) {
            failure = error;
            if (runExists) {
                try {
                    if (snapshotContext != null) {
                        persistence.recordSourceSnapshotContext(command.runId(), snapshotContext);
                    }
                } catch (RuntimeException snapshotContextError) {
                    error.addSuppressed(snapshotContextError);
                }
                try {
                    Map<String, Object> detail = new LinkedHashMap<>();
                    detail.put("stage", stage);
                    detail.put("sourceKey", command.sourceKey());
                    if (currentDataset != null) detail.put("datasetKey", currentDataset);
                    persistence.failSourceRun(command.runId(), failureCode(error), detail);
                } catch (RuntimeException failureAuditError) {
                    error.addSuppressed(failureAuditError);
                }
            }
            throw error;
        } finally {
            if (!spoolCleaned) cleanupSpool(spoolDirectory, spoolFiles, failure);
        }
    }

    private static Path createSpoolDirectory() {
        try {
            return Files.createTempDirectory("ontology-agent-source-spool-");
        } catch (IOException | SecurityException error) {
            throw new SourceConnectorException("INGESTION_SPOOL_CREATE_FAILED",
                    "source batch spool directory could not be created", error);
        }
    }

    private static Path spoolPath(Path directory, String datasetKey, long batchNumber) {
        if (directory == null) {
            throw new IllegalArgumentException("spool directory must not be null");
        }
        if (datasetKey == null || !SPOOL_DATASET_KEY.matcher(datasetKey).matches()) {
            throw new SourceConnectorException("INGESTION_SPOOL_NAME_INVALID",
                    "dataset key cannot be used as a spool filename: " + datasetKey);
        }
        if (batchNumber <= 0) {
            throw new SourceConnectorException("INGESTION_SPOOL_NAME_INVALID",
                    "batch number must be positive for spool filename");
        }
        return directory.resolve(datasetKey + "-batch-" + batchNumber + ".rowpack");
    }

    private static void writeSpoolBatch(Path path, byte[] payload,
                                        String datasetKey, long batchNumber) {
        if (payload == null || payload.length == 0) {
            throw new SourceConnectorException("INGESTION_SPOOL_WRITE_FAILED",
                    "encoded source batch is empty for " + datasetKey + " batch " + batchNumber);
        }
        try {
            Files.write(path, payload, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } catch (IOException | SecurityException error) {
            throw new SourceConnectorException("INGESTION_SPOOL_WRITE_FAILED",
                    "source batch spool write failed for " + datasetKey + " batch " + batchNumber,
                    error);
        }
    }

    private static byte[] readSpoolBatch(Path path, String datasetKey, long batchNumber) {
        try {
            if (!Files.isRegularFile(path)) {
                throw new IOException("spool batch is not a regular file");
            }
            byte[] payload = Files.readAllBytes(path);
            if (payload.length == 0) {
                throw new IOException("spool batch is empty");
            }
            return payload;
        } catch (IOException | SecurityException error) {
            throw new SourceConnectorException("INGESTION_SPOOL_READ_FAILED",
                    "source batch spool read failed for " + datasetKey + " batch " + batchNumber,
                    error);
        }
    }

    private static void cleanupSpool(Path directory, List<Path> files, RuntimeException failure) {
        if (directory == null) return;
        SourceConnectorException cleanupError = null;
        for (Path file : files) {
            try {
                Files.deleteIfExists(file);
            } catch (IOException | SecurityException error) {
                SourceConnectorException current = new SourceConnectorException(
                        "INGESTION_SPOOL_CLEANUP_FAILED",
                        "source batch spool file cleanup failed", error);
                if (cleanupError == null) cleanupError = current;
                else cleanupError.addSuppressed(current);
            }
        }
        try {
            Files.deleteIfExists(directory);
        } catch (IOException | SecurityException error) {
            SourceConnectorException current = new SourceConnectorException(
                    "INGESTION_SPOOL_CLEANUP_FAILED",
                    "source batch spool directory cleanup failed", error);
            if (cleanupError == null) cleanupError = current;
            else cleanupError.addSuppressed(current);
        }
        if (cleanupError == null) return;
        if (failure != null) failure.addSuppressed(cleanupError);
        else throw cleanupError;
    }

    private static Map<String, DatasetVersion> indexVersions(List<DatasetVersion> versions) {
        Map<String, DatasetVersion> result = new LinkedHashMap<>();
        for (DatasetVersion version : versions) {
            if (result.putIfAbsent(version.datasetKey(), version) != null) {
                throw new IllegalStateException("duplicate reserved version for dataset "
                        + version.datasetKey());
            }
        }
        return Map.copyOf(result);
    }

    private static void requirePageDataset(SourcePage page, String datasetKey) {
        if (!datasetKey.equals(page.datasetKey())) {
            throw new SourceConnectorException("SOURCE_PAGE_DATASET_MISMATCH",
                    "source page belongs to " + page.datasetKey() + ", expected " + datasetKey);
        }
    }

    private static String versionId(String runId, String datasetKey) {
        return UUID.nameUUIDFromBytes(("source-version:" + runId + ":" + datasetKey)
                .getBytes(StandardCharsets.UTF_8)).toString();
    }

    private static String parentVersionId(IngestionRun.Mode mode, IngestionCursor cursor) {
        return mode == IngestionRun.Mode.INCREMENTAL && cursor != null
                ? cursor.lastSuccessfulVersionId() : null;
    }

    private static String failureCode(RuntimeException error) {
        if (error instanceof SourceConnectorException connectorError) return connectorError.code();
        if (error instanceof BackendException backendError) return backendError.code();
        if (error instanceof IllegalArgumentException) return "INGESTION_CONTRACT_INVALID";
        return "INGESTION_FAILED";
    }

    public record Command(String runId, String sourceKey, IngestionRun.Mode mode,
                          IngestionRun.TriggerType triggerType, String triggeredBy,
                          String correlationId, int pageSize) {
        public Command {
            requireId(runId, "runId");
            requireKey(sourceKey, "sourceKey");
            if (mode == null) throw new IllegalArgumentException("mode must not be null");
            if (triggerType == null) throw new IllegalArgumentException("triggerType must not be null");
            if (triggeredBy != null && triggeredBy.isBlank()) {
                throw new IllegalArgumentException("triggeredBy must not be blank");
            }
            if (correlationId != null && correlationId.isBlank()) {
                throw new IllegalArgumentException("correlationId must not be blank");
            }
            if (pageSize <= 0 || pageSize > 10_000) {
                throw new IllegalArgumentException("pageSize must be between 1 and 10000");
            }
        }

        private static void requireId(String value, String field) {
            if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
                throw new IllegalArgumentException(field + " must be a restricted opaque id");
            }
        }

        private static void requireKey(String value, String field) {
            if (value == null || !value.matches("[a-z][a-z0-9_-]*")) {
                throw new IllegalArgumentException(field + " must be a restricted catalog key");
            }
        }
    }

    public record Result(String runId, List<DatasetVersion> versions) {
        public Result {
            if (runId == null || runId.isBlank()) throw new IllegalArgumentException("runId must not be blank");
            if (versions == null || versions.isEmpty() || versions.stream().anyMatch(item -> item == null)) {
                throw new IllegalArgumentException("versions must not be null or empty");
            }
            versions = List.copyOf(versions);
        }
    }

    private record DatasetPublicationState(String datasetKey,
                                           SourceBatchManifest.Aggregate aggregate,
                                           Map<String, Object> committedCursor) {
        private DatasetPublicationState {
            committedCursor = Map.copyOf(committedCursor);
        }
    }

    private record DatasetSpoolState(String datasetKey, List<SpoolBatch> batches,
                                     Map<String, Object> committedCursor) {
        private DatasetSpoolState {
            batches = List.copyOf(batches);
            committedCursor = Map.copyOf(committedCursor);
        }
    }

    private record SpoolBatch(long batchNumber, long rowCount, Path path) {
        private SpoolBatch {
            if (batchNumber <= 0) throw new IllegalArgumentException("batchNumber must be positive");
            if (rowCount <= 0) throw new IllegalArgumentException("rowCount must be positive");
            Objects.requireNonNull(path, "path must not be null");
        }
    }
}
