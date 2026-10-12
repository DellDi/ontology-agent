package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionRetentionService;
import com.dip3.ontologyagent.ingestion.internal.domain.IngestionRetentionPolicy;
import com.dip3.ontologyagent.support.JsonCodec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import java.time.Instant;

@Component
@Profile("ingestion-retention")
public class IngestionRetentionRunner implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(IngestionRetentionRunner.class);
    private final IngestionRetentionService service;
    private final JsonCodec json;
    private final IngestionRetentionPolicy policy;
    private final boolean apply;
    public IngestionRetentionRunner(IngestionRetentionService service, JsonCodec json,
            @Value("${dip3.ingestion.retention.days:30}") int days,
            @Value("${dip3.ingestion.retention.releases:5}") int releases,
            @Value("${dip3.ingestion.retention.apply:false}") boolean apply) {
        this.service = service; this.json = json;
        this.policy = new IngestionRetentionPolicy(days, releases); this.apply = apply;
    }
    @Override public void run(ApplicationArguments args) {
        try {
            log.info("ingestion_retention_result {}", json.write(service.run(policy, apply, Instant.now())));
        } catch (RuntimeException error) {
            log.error("ingestion_retention_failed", error);
            System.exit(1);
            throw error;
        }
        System.exit(0);
    }
}
