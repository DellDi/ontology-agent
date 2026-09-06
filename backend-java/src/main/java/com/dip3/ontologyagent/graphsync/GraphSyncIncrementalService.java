package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Admin operations retained at the existing API boundary after canonical projection cutover. */
@Service
public final class GraphSyncIncrementalService {
    private final GraphSyncService rebuilds;
    private final GraphSyncRunRepository runs;

    public GraphSyncIncrementalService(GraphSyncService rebuilds, GraphSyncRunRepository runs) {
        this.rebuilds = rebuilds;
        this.runs = runs;
    }

    public List<GraphSyncRun> sweep(AuthSession actor, String correlationId) {
        requirePlatformAdmin(actor);
        return List.of(rebuilds.rebuild(actor.scope().organizationId(), actor.userId(),
                "consistency-sweep", "manual", Map.of("correlationId", correlationId)));
    }

    public GraphSyncStatus status(AuthSession actor) {
        requirePlatformAdmin(actor);
        return new GraphSyncStatus(runs.latest(actor.scope().organizationId()).orElse(null),
                Map.of(), List.of(), List.of());
    }

    private static void requirePlatformAdmin(AuthSession actor) {
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("GRAPH_SYNC_FORBIDDEN", "只有 PLATFORM_ADMIN 可以管理图谱同步。 ");
        }
    }
}
