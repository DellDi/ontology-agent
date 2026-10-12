package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.support.BackendException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Turns due schedule fires into durable release tasks; execution stays with the release worker queue. */
public class IngestionScheduleService {
    private static final Logger log = LoggerFactory.getLogger(IngestionScheduleService.class);
    private final IngestionReleaseService releases;
    private final List<IngestionSchedule> schedules;
    private final Map<String, Instant> settled = new ConcurrentHashMap<>();

    public IngestionScheduleService(IngestionReleaseService releases, List<IngestionSchedule> schedules) {
        if (schedules.stream().map(IngestionSchedule::name).distinct().count() != schedules.size()) {
            throw new IllegalArgumentException("ingestion schedule names must be unique");
        }
        this.releases = releases;
        this.schedules = List.copyOf(schedules);
    }

    public void runDue(Instant now) {
        for (IngestionSchedule schedule : schedules) {
            Instant fire = schedule.latestFire(now).orElse(null);
            if (fire == null || fire.equals(settled.get(schedule.name()))) continue;
            try {
                var result = releases.submitScheduled(schedule, fire);
                settled.put(schedule.name(), fire);
                if (result.task() != null) {
                    log.info("ingestion_release_scheduled schedule={} fireTime={} taskId={}",
                            schedule.name(), fire, result.task().id());
                } else {
                    log.warn("ingestion_release_schedule_skipped schedule={} fireTime={} blockedBy={}",
                            schedule.name(), fire, result.blockedBy());
                }
            } catch (BackendException error) {
                // Catalog or contract drift will not heal by retrying the same fire; surface it once and move on.
                settled.put(schedule.name(), fire);
                log.error("ingestion_release_schedule_rejected schedule={} fireTime={} code={}",
                        schedule.name(), fire, error.code(), error);
            } catch (RuntimeException error) {
                // Likely transient infrastructure failure: leave the fire unsettled so the next tick retries it.
                log.error("ingestion_release_schedule_failed schedule={} fireTime={}", schedule.name(), fire, error);
            }
        }
    }
}
