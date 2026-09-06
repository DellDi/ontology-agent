package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
public final class GraphSyncService {
    private final GraphSyncRunRepository runs;
    private final GraphBatchBuilder batches;
    private final GraphWriter graph;
    private final GraphSyncLease leases;

    public GraphSyncService(GraphSyncRunRepository runs, GraphBatchBuilder batches, GraphWriter graph,
                            GraphSyncLease leases) {
        this.runs = runs;
        this.batches = batches;
        this.graph = graph;
        this.leases = leases;
    }

    public GraphSyncRun rebuild(String organizationId, AuthSession actor) {
        return rebuild(organizationId, actor, java.util.Map.of());
    }

    public GraphSyncRun rebuild(String organizationId, AuthSession actor, java.util.Map<String, Object> metadata) {
        return rebuild(organizationId, actor, metadata, null);
    }

    public GraphSyncRun rebuild(String organizationId, AuthSession actor, Map<String, Object> metadata,
                                String datasetVersionSetId) {
        requirePlatformAdmin(organizationId, actor);
        GraphProjection projection = datasetVersionSetId == null
                ? batches.latestProjection() : batches.requireProjection(datasetVersionSetId);
        return rebuild(organizationId, actor.userId(), "org-rebuild", "manual", metadata,
                projection);
    }

    GraphSyncRun rebuild(String organizationId, String triggeredBy, String mode, String triggerType,
                         java.util.Map<String, Object> cursorSnapshot) {
        return rebuild(organizationId, triggeredBy, mode, triggerType, cursorSnapshot,
                batches.latestProjection());
    }

    GraphSyncRun rebuild(String organizationId, String triggeredBy, String mode, String triggerType,
                         Map<String, Object> metadata, GraphProjection projection) {
        Map<String, Object> cursorSnapshot = projectionMetadata(metadata, projection);
        GraphSyncRun pending = runs.createLocked(UUID.randomUUID().toString(), organizationId, triggeredBy,
                mode, triggerType, cursorSnapshot);
        try {
            runs.running(pending.id());
            try (GraphSyncLease.Guard ignored = leases.start(pending.id())) {
            GraphBatch batch;
            try {
                batch = batches.build(organizationId, pending.id(), projection);
            } catch (GraphSyncException error) {
                boolean deletedOrganization = "incremental-rebuild".equals(mode)
                        && "GRAPH_SYNC_ORGANIZATION_NOT_FOUND".equals(error.code())
                        && Boolean.TRUE.equals(cursorSnapshot.get("organizationDeleted"));
                if (!deletedOrganization) throw error;
                batch = new GraphBatch(java.util.List.of(), java.util.List.of());
            }
            runs.heartbeat(pending.id());
            GraphWriter.WriteResult result = graph.replaceOrganization(organizationId,
                    projection, pending.id(), fencingToken(pending), batch);
            runs.heartbeat(pending.id());
            runs.completed(pending.id(), result);
            return runs.latest(organizationId).orElseThrow();
            }
        } catch (GraphSyncException error) {
            runs.failed(pending.id(), error.partialWrite(), error.code(), error.getMessage());
            throw new BackendException(error.code(), error.getMessage(), error);
        } catch (RuntimeException error) {
            runs.failed(pending.id(), false, "GRAPH_SYNC_FAILED", "组织图谱重建失败。 ");
            throw error;
        }
    }

    private static Map<String, Object> projectionMetadata(Map<String, Object> metadata,
                                                           GraphProjection projection) {
        if (metadata == null) throw new IllegalArgumentException("metadata must not be null");
        Object requested = metadata.get("datasetVersionSetId");
        if (requested != null && !projection.datasetVersionSetId().equals(requested)) {
            throw new BackendException("GRAPH_SYNC_DATASET_VERSION_SET_CONFLICT",
                    "Graph Sync 请求的数据版本与实际投影版本不一致。");
        }
        Map<String, Object> result = new LinkedHashMap<>(metadata);
        result.put("datasetVersionSetId", projection.datasetVersionSetId());
        result.put("productVersionIds", projection.productVersionIds());
        return Map.copyOf(result);
    }

    private static long fencingToken(GraphSyncRun run) {
        Object token = run.cursorSnapshot().get("fencingToken");
        if (!(token instanceof Number number)) {
            throw new BackendException("GRAPH_SYNC_FENCING_TOKEN_MISSING", "Graph Sync run 缺失 fencing token。 ");
        }
        return number.longValue();
    }

    public GraphSyncRun status(String organizationId, AuthSession actor) {
        requirePlatformAdmin(organizationId, actor);
        return runs.latest(organizationId)
                .orElseThrow(() -> new BackendException("GRAPH_SYNC_NOT_FOUND", "该组织还没有图谱同步记录。 "));
    }

    private static void requirePlatformAdmin(String organizationId, AuthSession actor) {
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("GRAPH_SYNC_FORBIDDEN",
                    "只有 PLATFORM_ADMIN 可以管理图谱同步。 ");
        }
        if (!actor.scope().organizationId().equals(organizationId)) {
            throw new BackendException("GRAPH_SYNC_SCOPE_FORBIDDEN",
                    "不能操作会话范围之外的组织。 ");
        }
    }
}
