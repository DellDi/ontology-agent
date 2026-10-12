package com.dip3.ontologyagent.ingestion.internal.application;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public interface IngestionRetentionPort {
    Result retain(Instant cutoff, int releases, boolean apply);
    record Result(boolean applied, Instant cutoff, int retainedReleases, List<String> versionSets,
                  List<String> products, List<String> sources, Map<String, Long> factRows,
                  long sourceBatches, long sourcePayloadBytes) {}
}
