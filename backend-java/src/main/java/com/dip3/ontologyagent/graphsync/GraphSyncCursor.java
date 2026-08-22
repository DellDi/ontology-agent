package com.dip3.ontologyagent.graphsync;

import java.time.Instant;

public record GraphSyncCursor(String sourceName, Instant cursorTime, String cursorPk,
                              String lastRunId, Instant updatedAt) {}
