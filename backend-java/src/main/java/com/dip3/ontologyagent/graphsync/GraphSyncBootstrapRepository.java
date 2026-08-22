package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Repository
public class GraphSyncBootstrapRepository {
    private final GraphSyncBootstrapMapper bootstrap;
    private final GraphSyncIncrementalMapper incremental;
    private final GraphSyncRunMapper runs;

    public GraphSyncBootstrapRepository(GraphSyncBootstrapMapper bootstrap,
                                        GraphSyncIncrementalMapper incremental,
                                        GraphSyncRunMapper runs) {
        this.bootstrap = bootstrap;
        this.incremental = incremental;
        this.runs = runs;
    }

    @Transactional(readOnly = true)
    public List<GraphSyncWatermark> captureWatermarks() { return bootstrap.watermarks(); }

    @Transactional(readOnly = true)
    public List<String> activeOrganizationIds() { return bootstrap.activeOrganizationIds(); }

    @Transactional(readOnly = true)
    public List<String> deletedOrganizationIds() { return bootstrap.deletedOrganizationIds(); }

    @Transactional
    public GraphSyncRun complete(String parentRunId, List<GraphSyncWatermark> watermarks,
                                 int organizationsCompleted, int nodesWritten, int edgesWritten) {
        Instant now = Instant.now();
        for (GraphSyncWatermark watermark : watermarks) {
            requireOne(incremental.saveCursor(watermark.sourceName(), watermark.cursorTime(), watermark.cursorPk(),
                    parentRunId, now));
        }
        incremental.completeAllDirty(parentRunId);
        requireOne(runs.transition(parentRunId, "running", "completed", nodesWritten, edgesWritten, null,
                Map.of("organizationsCompleted", organizationsCompleted), null, now, now));
        GraphSyncRun completed = runs.latestScope("all", "all");
        if (completed == null || !parentRunId.equals(completed.id())) {
            throw new BackendException("GRAPH_SYNC_STATE_CONFLICT", "Full bootstrap 终态读取不一致。 ");
        }
        return completed;
    }

    private static void requireOne(int changed) {
        if (changed != 1) {
            throw new BackendException("GRAPH_SYNC_STATE_CONFLICT", "Full bootstrap 状态已被其他任务修改。 ");
        }
    }
}
