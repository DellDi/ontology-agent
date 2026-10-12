package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleaseService;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionSchedule;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionScheduleService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/** Enqueues due recurring releases; the release worker remains the only executor. */
@Component
@ConditionalOnProperty(prefix = "dip3.ingestion.release-worker", name = "enabled", havingValue = "true")
@ConditionalOnProperty(prefix = "dip3.ingestion.release-worker.schedule", name = "enabled", havingValue = "true")
public class IngestionReleaseScheduleTrigger {
    private static final Logger log = LoggerFactory.getLogger(IngestionReleaseScheduleTrigger.class);
    private final IngestionScheduleService schedules;

    public IngestionReleaseScheduleTrigger(IngestionReleaseService releases, IngestionScheduleProperties properties) {
        List<IngestionSchedule> configured = properties.schedules();
        if (configured.isEmpty()) {
            throw new IllegalStateException("dip3.ingestion.release-worker.schedule.enabled=true requires at least one item");
        }
        configured.forEach(schedule -> log.info("ingestion_schedule_registered name={} sourceKey={} mode={} products={}",
                schedule.name(), schedule.sourceKey(), schedule.mode(), schedule.productKeys()));
        this.schedules = new IngestionScheduleService(releases, configured);
    }

    @Scheduled(fixedDelayString = "${dip3.ingestion.release-worker.schedule.tick:PT30S}")
    public void tick() {
        schedules.runDue(Instant.now());
    }
}
