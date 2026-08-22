package com.dip3.ontologyagent.graphsync;

import java.time.Instant;

public record GraphSyncChange(String sourcePk, String organizationId, Instant cursorTime) {}
