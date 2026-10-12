package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.internal.domain.IngestionRetentionPolicy;
import org.springframework.stereotype.Service;
import java.time.Instant;

@Service
public class IngestionRetentionService {
    private final IngestionRetentionPort retention;
    public IngestionRetentionService(IngestionRetentionPort retention) { this.retention = retention; }
    public IngestionRetentionPort.Result run(IngestionRetentionPolicy policy, boolean apply, Instant now) {
        return retention.retain(policy.cutoff(now), policy.releases(), apply);
    }
}
