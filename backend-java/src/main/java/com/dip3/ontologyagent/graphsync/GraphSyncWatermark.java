package com.dip3.ontologyagent.graphsync;

import java.time.Instant;

public record GraphSyncWatermark(String sourceName, Instant cursorTime, String cursorPk, int invalidRows) {}
