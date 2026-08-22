package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public final class GraphSyncBootstrapService {
    private final GraphSyncRunRepository runs;
    private final GraphSyncBootstrapRepository bootstrap;
    private final GraphSyncService rebuilds;
    private final GraphSyncLease leases;

    public GraphSyncBootstrapService(GraphSyncRunRepository runs, GraphSyncBootstrapRepository bootstrap,
                                     GraphSyncService rebuilds, GraphSyncLease leases) {
        this.runs = runs;
        this.bootstrap = bootstrap;
        this.rebuilds = rebuilds;
        this.leases = leases;
    }

    public GraphSyncRun run(String correlationId) {
        List<GraphSyncWatermark> watermarks = bootstrap.captureWatermarks();
        GraphSyncRun parent = runs.createBootstrapLocked(UUID.randomUUID().toString(), "system-ops",
                snapshot(watermarks, correlationId));
        int completedOrganizations = 0;
        try {
            runs.running(parent.id());
            try (GraphSyncLease.Guard ignored = leases.start(parent.id())) {
                validate(watermarks);
                int nodes = 0;
                int edges = 0;
                for (String organizationId : bootstrap.activeOrganizationIds()) {
                    runs.heartbeat(parent.id());
                    GraphSyncRun child = rebuilds.rebuild(organizationId, "system-ops", "org-rebuild", "system",
                            Map.of("parentRunId", parent.id(), "correlationId", correlationId));
                    completedOrganizations++;
                    nodes += child.nodesWritten();
                    edges += child.edgesWritten();
                }
                for (String organizationId : bootstrap.deletedOrganizationIds()) {
                    runs.heartbeat(parent.id());
                    rebuilds.rebuild(organizationId, "system-ops", "incremental-rebuild", "system", Map.of(
                            "parentRunId", parent.id(), "correlationId", correlationId,
                            "organizationDeleted", true));
                }
                runs.heartbeat(parent.id());
                return bootstrap.complete(parent.id(), watermarks, completedOrganizations, nodes, edges);
            }
        } catch (BackendException error) {
            runs.failed(parent.id(), false, error.code(), error.getMessage());
            throw error;
        } catch (RuntimeException error) {
            runs.failed(parent.id(), false, "GRAPH_SYNC_BOOTSTRAP_FAILED", "全量图谱初始化失败。 ");
            throw error;
        }
    }

    public GraphSyncRun status() {
        return runs.latestBootstrap().orElseThrow(() ->
                new BackendException("GRAPH_SYNC_BOOTSTRAP_NOT_FOUND", "尚无 Full bootstrap 运行事实。 "));
    }

    private static void validate(List<GraphSyncWatermark> watermarks) {
        if (watermarks.size() != GraphSyncSource.values().length ||
                !watermarks.stream().map(GraphSyncWatermark::sourceName).collect(java.util.stream.Collectors.toSet())
                        .equals(new java.util.HashSet<>(GraphSyncSource.names()))) {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_WATERMARK_INCOMPLETE",
                    "未能捕获全部 7 个 ERP source watermark。 ");
        }
        watermarks.stream().filter(watermark -> watermark.invalidRows() != 0).findFirst().ifPresent(watermark -> {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_SOURCE_INVALID",
                    watermark.sourceName() + " 存在 " + watermark.invalidRows() + " 条缺失 scope/time/pk 的源记录。 ");
        });
    }

    private static Map<String, Object> snapshot(List<GraphSyncWatermark> watermarks, String correlationId) {
        Map<String, Object> sources = new LinkedHashMap<>();
        for (GraphSyncWatermark watermark : watermarks) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("cursorTime", watermark.cursorTime() == null ? null : watermark.cursorTime().toString());
            value.put("cursorPk", watermark.cursorPk());
            value.put("invalidRows", watermark.invalidRows());
            sources.put(watermark.sourceName(), value);
        }
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("capturedAt", Instant.now().toString());
        snapshot.put("correlationId", correlationId);
        snapshot.put("watermarks", sources);
        return snapshot;
    }
}
