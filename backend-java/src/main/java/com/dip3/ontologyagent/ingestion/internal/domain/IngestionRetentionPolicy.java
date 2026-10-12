package com.dip3.ontologyagent.ingestion.internal.domain;

import java.time.Duration;
import java.time.Instant;

/** Recent data is retained in addition to all live execution and ingestion dependencies. */
public record IngestionRetentionPolicy(int days, int releases) {
    public IngestionRetentionPolicy {
        if (days < 1 || releases < 1) throw new IllegalArgumentException("retention days and releases must be positive");
    }
    public Instant cutoff(Instant now) { return now.minus(Duration.ofDays(days)); }
}
