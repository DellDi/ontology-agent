package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public final class GraphSyncIncrementalService {
    static final int SCAN_LIMIT = 10_000;
    private final GraphSyncSourceMapper sources;
    private final GraphSyncIncrementalRepository state;
    private final GraphSyncService rebuilds;
    private final GraphSyncRunRepository runs;
    private final GraphSyncLease leases;

    public GraphSyncIncrementalService(GraphSyncSourceMapper sources, GraphSyncIncrementalRepository state,
                                       GraphSyncService rebuilds, GraphSyncRunRepository runs, GraphSyncLease leases) {
        this.sources = sources;
        this.state = state;
        this.rebuilds = rebuilds;
        this.runs = runs;
        this.leases = leases;
    }

    public GraphSyncIncrementalResult run(String sourceName, AuthSession actor) {
        requirePlatformAdmin(actor);
        throw new BackendException("GRAPH_SYNC_GLOBAL_OPERATION_FORBIDDEN",
                "手工全局 source scan 已禁用；请使用组织 rebuild，增量扫描仅由系统调度执行。 ");
    }

    public GraphSyncIncrementalResult runScheduled(String sourceName) {
        return run(sourceName, "graph-sync-scheduler", "scheduler");
    }

    private GraphSyncIncrementalResult run(String sourceName, String triggeredBy, String triggerType) {
        GraphSyncSource source = requireSource(sourceName);
        GraphSyncRun sourceRun = runs.createSourceLocked(UUID.randomUUID().toString(), sourceName, triggeredBy);
        try {
            runs.running(sourceRun.id());
            try (GraphSyncLease.Guard ignored = leases.start(sourceRun.id())) {
            GraphSyncIncrementalResult result = runLocked(source, triggeredBy, triggerType, sourceRun.id());
            if (result.failedScopeKey() != null) {
                runs.failed(sourceRun.id(), !result.rebuiltOrganizations().isEmpty(), "GRAPH_SYNC_DIRTY_SCOPE_FAILED",
                        "组织 " + result.failedScopeKey() + " 重建失败，source cursor 未推进。 ");
                throw new BackendException("GRAPH_SYNC_DIRTY_SCOPE_FAILED",
                        "增量派发失败，source cursor 未推进。 ");
            }
            runs.heartbeat(sourceRun.id());
            runs.completed(sourceRun.id(), new GraphWriter.WriteResult(0, 0, 0, 0));
            return result;
            }
        } catch (BackendException error) {
            if (!"GRAPH_SYNC_DIRTY_SCOPE_FAILED".equals(error.code())) {
                runs.failed(sourceRun.id(), false, error.code(), error.getMessage());
            }
            throw error;
        } catch (RuntimeException error) {
            runs.failed(sourceRun.id(), false, "GRAPH_SYNC_INCREMENTAL_FAILED", "增量同步失败。 ");
            throw error;
        }
    }

    public List<GraphSyncRun> sweep(AuthSession actor, String correlationId) {
        requirePlatformAdmin(actor);
        return List.of(rebuilds.rebuild(actor.scope().organizationId(), actor.userId(), "consistency-sweep",
                "manual", Map.of("correlationId", correlationId)));
    }

    public GraphSyncStatus status(AuthSession actor) {
        requirePlatformAdmin(actor);
        String organizationId = actor.scope().organizationId();
        return new GraphSyncStatus(runs.latest(organizationId).orElse(null), state.backlog(organizationId), List.of(),
                state.failures(organizationId, 20));
    }

    GraphSyncIncrementalResult runLocked(GraphSyncSource source, String triggeredBy, String triggerType) {
        return runLocked(source, triggeredBy, triggerType, null);
    }

    private GraphSyncIncrementalResult runLocked(GraphSyncSource source, String triggeredBy, String triggerType,
                                                  String sourceRunId) {
        state.requeueRetryable(source.sourceName(), 3);
        GraphSyncCursor cursor = state.cursor(source.sourceName()).orElse(null);
        List<GraphSyncChange> changes = scan(source, cursor);
        List<String> diagnostics = new ArrayList<>();
        LinkedHashSet<String> organizations = new LinkedHashSet<>();
        GraphSyncChange target = null;
        for (GraphSyncChange raw : changes) {
            GraphSyncChange change = raw;
            if (change.cursorTime() == null) {
                throw new BackendException("GRAPH_SYNC_CURSOR_MISSING", source.sourceName() + " source_pk="
                        + change.sourcePk() + " 缺失变更时间，cursor 未推进。 ");
            }
            if (change.organizationId() == null || change.organizationId().isBlank()) {
                throw new BackendException("GRAPH_SYNC_SCOPE_MISSING", source.sourceName() + " source_pk="
                        + change.sourcePk() + " 缺失 organizationId，cursor 未推进。 ");
            }
            state.record(source, change);
            organizations.add(change.organizationId());
            target = change;
        }

        List<String> rebuilt = new ArrayList<>();
        for (GraphSyncDirtyScope scope : state.pending(source.sourceName())) {
            fence(sourceRunId);
            state.claim(scope.id(), sourceRunId);
            try {
                Map<String, Object> snapshot = new java.util.LinkedHashMap<>(scope.sourceProgress());
                if (source == GraphSyncSource.ORGANIZATIONS && sourceDeleted(scope.scopeKey())) {
                    snapshot.put("organizationDeleted", true);
                }
                GraphSyncRun run = rebuilds.rebuild(scope.scopeKey(), triggeredBy, "incremental-rebuild",
                        triggerType, snapshot);
                state.completed(scope.id(), run.id());
                rebuilt.add(scope.scopeKey());
            } catch (RuntimeException error) {
                state.failed(scope.id(), sourceRunId, error.getMessage());
                return new GraphSyncIncrementalResult(source.sourceName(), changes.size(), organizations.size(),
                        rebuilt, false, scope.scopeKey(), diagnostics);
            }
        }
        if (target != null) {
            fence(sourceRunId);
            state.advance(source.sourceName(), target, sourceRunId);
        }
        return new GraphSyncIncrementalResult(source.sourceName(), changes.size(), organizations.size(), rebuilt,
                target != null, null, diagnostics);
    }

    private void fence(String sourceRunId) {
        if (sourceRunId != null) runs.heartbeat(sourceRunId);
    }

    private List<GraphSyncChange> scan(GraphSyncSource source, GraphSyncCursor cursor) {
        java.time.Instant time = cursor == null ? null : cursor.cursorTime();
        String pk = cursor == null ? null : cursor.cursorPk();
        return switch (source) {
            case ORGANIZATIONS -> sources.scanOrganizations(time, pk, SCAN_LIMIT);
            case PROJECTS -> sources.scanProjects(time, pk, SCAN_LIMIT);
            case OWNERS -> sources.scanOwners(time, pk, SCAN_LIMIT);
            case CHARGE_ITEMS -> sources.scanChargeItems(time, pk, SCAN_LIMIT);
            case RECEIVABLES -> sources.scanReceivables(time, pk, SCAN_LIMIT);
            case PAYMENTS -> sources.scanPayments(time, pk, SCAN_LIMIT);
            case SERVICE_ORDERS -> sources.scanServiceOrders(time, pk, SCAN_LIMIT);
        };
    }

    private boolean sourceDeleted(String organizationId) {
        return sources.organizations(organizationId).stream()
                .noneMatch(row -> organizationId.equals(String.valueOf(row.get("id"))));
    }

    private static GraphSyncSource requireSource(String sourceName) {
        try {
            return GraphSyncSource.require(sourceName);
        } catch (IllegalArgumentException error) {
            throw new BackendException("GRAPH_SYNC_SOURCE_INVALID", error.getMessage());
        }
    }

    private static void requirePlatformAdmin(AuthSession actor) {
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("GRAPH_SYNC_FORBIDDEN", "只有 PLATFORM_ADMIN 可以管理图谱同步。 ");
        }
    }
}
