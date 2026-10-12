package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionRetentionService;
import com.dip3.ontologyagent.ingestion.internal.domain.IngestionRetentionPolicy;
import com.dip3.ontologyagent.support.JsonCodec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.Instant;

@Component
@ConditionalOnProperty(prefix="dip3.ingestion.release-worker", name="enabled", havingValue="true")
@ConditionalOnProperty(prefix="dip3.ingestion.retention", name="enabled", havingValue="true")
public class IngestionRetentionTrigger {
    private static final Logger log = LoggerFactory.getLogger(IngestionRetentionTrigger.class);
    private final IngestionRetentionService service;
    private final JsonCodec json;
    private final IngestionRetentionPolicy policy;
    public IngestionRetentionTrigger(IngestionRetentionService service, JsonCodec json,
            @Value("${dip3.ingestion.retention.days:30}") int days,
            @Value("${dip3.ingestion.retention.releases:5}") int releases) {
        this.service = service; this.json = json; this.policy = new IngestionRetentionPolicy(days, releases);
        log.info("ingestion_retention_registered days={} releases={}", days, releases);
    }
    @Scheduled(cron="0 0 3 * * *", zone="Asia/Shanghai")
    public void run() {
        try { log.info("ingestion_retention_result {}", json.write(service.run(policy, true, Instant.now()))); }
        catch (RuntimeException error) {
            log.error("ingestion_retention_failed", error);
            throw error;
        }
    }
}
