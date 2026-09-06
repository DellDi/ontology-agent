package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Rebuilds Neo4j from one complete frozen canonical dataset version set. */
@Service
public final class GraphSyncBootstrapService {
    private final GraphSyncRunRepository runs;
    private final GraphBatchBuilder batches;
    private final GraphSyncService rebuilds;
    private final GraphSyncLease leases;

    public GraphSyncBootstrapService(GraphSyncRunRepository runs, GraphBatchBuilder batches,
                                     GraphSyncService rebuilds, GraphSyncLease leases) {
        this.runs = runs;
        this.batches = batches;
        this.rebuilds = rebuilds;
        this.leases = leases;
    }

    public GraphSyncRun run(String correlationId) {
        return run(correlationId, batches.latestProjection());
    }

    public GraphSyncRun run(String correlationId, String datasetVersionSetId) {
        GraphProjection projection = datasetVersionSetId == null
                ? batches.latestProjection() : batches.requireProjection(datasetVersionSetId);
        return run(correlationId, projection);
    }

    /** Scheduler entry: an already completed projection is immutable and is not rebuilt. */
    public Optional<GraphSyncRun> runIfOutdated(String correlationId) {
        GraphProjection projection = batches.latestProjection();
        Optional<GraphSyncRun> latest = runs.latestBootstrap();
        if (latest.filter(run -> "completed".equals(run.status()))
                .map(GraphSyncRun::cursorSnapshot)
                .map(snapshot -> snapshot.get("datasetVersionSetId"))
                .filter(projection.datasetVersionSetId()::equals)
                .isPresent()) {
            return Optional.empty();
        }
        return Optional.of(run(correlationId, projection));
    }

    private GraphSyncRun run(String correlationId, GraphProjection projection) {
        GraphSyncRun parent = runs.createBootstrapLocked(UUID.randomUUID().toString(), "system-ops",
                snapshot(projection, correlationId));
        int completedOrganizations = 0;
        try {
            runs.running(parent.id());
            try (GraphSyncLease.Guard ignored = leases.start(parent.id())) {
                int nodes = 0;
                int edges = 0;
                for (String organizationId : batches.activeOrganizationIds(projection)) {
                    runs.heartbeat(parent.id());
                    GraphSyncRun child = rebuilds.rebuild(organizationId, "system-ops", "org-rebuild",
                            "system", Map.of("parentRunId", parent.id(),
                                    "correlationId", correlationId), projection);
                    completedOrganizations++;
                    nodes += child.nodesWritten();
                    edges += child.edgesWritten();
                }
                runs.heartbeat(parent.id());
                runs.completed(parent.id(), new GraphWriter.WriteResult(nodes, edges, 0, 0));
                return runs.latestBootstrap().filter(run -> parent.id().equals(run.id()))
                        .orElseThrow(() -> new BackendException("GRAPH_SYNC_STATE_CONFLICT",
                                "Canonical graph bootstrap 终态读取不一致。"));
            }
        } catch (BackendException error) {
            runs.failed(parent.id(), completedOrganizations != 0, error.code(), error.getMessage());
            throw error;
        } catch (RuntimeException error) {
            runs.failed(parent.id(), completedOrganizations != 0,
                    "GRAPH_SYNC_BOOTSTRAP_FAILED", "Canonical graph bootstrap 失败。");
            throw error;
        }
    }

    public GraphSyncRun status() {
        return runs.latestBootstrap().orElseThrow(() ->
                new BackendException("GRAPH_SYNC_BOOTSTRAP_NOT_FOUND", "尚无 Full bootstrap 运行事实。"));
    }

    private static Map<String, Object> snapshot(GraphProjection projection, String correlationId) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("capturedAt", Instant.now().toString());
        snapshot.put("correlationId", correlationId);
        snapshot.put("datasetVersionSetId", projection.datasetVersionSetId());
        snapshot.put("productVersionIds", projection.productVersionIds());
        return Map.copyOf(snapshot);
    }
}
