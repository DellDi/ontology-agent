package com.dip3.ontologyagent.graphsync;

import java.util.List;

public record GraphSyncIncrementalResult(String sourceName, int scannedChangeCount, int dirtyScopeCount,
                                         List<String> rebuiltOrganizations, boolean cursorAdvanced,
                                         String failedScopeKey, List<String> diagnostics) {}
