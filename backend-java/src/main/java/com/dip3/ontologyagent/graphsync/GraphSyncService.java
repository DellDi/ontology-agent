package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

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
        requirePlatformAdmin(organizationId, actor);
        return rebuild(organizationId, actor.userId(), "org-rebuild", "manual", metadata);
    }

    GraphSyncRun rebuild(String organizationId, String triggeredBy, String mode, String triggerType,
                         java.util.Map<String, Object> cursorSnapshot) {
        GraphSyncRun pending = runs.createLocked(UUID.randomUUID().toString(), organizationId, triggeredBy,
                mode, triggerType, cursorSnapshot);
        try {
            runs.running(pending.id());
            try (GraphSyncLease.Guard ignored = leases.start(pending.id())) {
            GraphBatch batch;
            try {
                batch = batches.build(organizationId, pending.id());
            } catch (GraphSyncException error) {
                boolean deletedOrganization = "incremental-rebuild".equals(mode)
                        && "GRAPH_SYNC_ORGANIZATION_NOT_FOUND".equals(error.code())
                        && Boolean.TRUE.equals(cursorSnapshot.get("organizationDeleted"));
                if (!deletedOrganization) throw error;
                batch = new GraphBatch(java.util.List.of(), java.util.List.of());
            }
            runs.heartbeat(pending.id());
            GraphWriter.WriteResult result = graph.replaceOrganization(organizationId, pending.id(),
                    fencingToken(pending), batch);
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
