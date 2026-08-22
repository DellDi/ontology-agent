package com.dip3.ontologyagent.graphsync;

import java.util.List;
import java.util.Map;

public record GraphSyncStatus(GraphSyncRun latestRun, Map<String, Integer> backlog,
                              List<GraphSyncCursor> cursors, List<GraphSyncDirtyScope> recentFailures) {}
