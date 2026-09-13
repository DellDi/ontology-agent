package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleaseWorker;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component
@ConditionalOnProperty(prefix = "dip3.ingestion.release-worker", name = "enabled", havingValue = "true")
public class IngestionReleaseScheduler {
    private static final Logger log = LoggerFactory.getLogger(IngestionReleaseScheduler.class);
    private final AtomicBoolean polling = new AtomicBoolean();
    private final IngestionReleaseWorker worker;

    public IngestionReleaseScheduler(IngestionReleaseWorker worker) {
        this.worker = worker;
    }

    @Scheduled(fixedDelayString = "${dip3.worker.poll-delay}")
    public void poll() {
        if (!polling.compareAndSet(false, true)) return;
        // Source reads can take minutes. Keep the shared scheduler free for analysis and leases.
        Thread.startVirtualThread(() -> {
            try { worker.runOne(); }
            catch (RuntimeException error) { log.error("ingestion_release_poll_failed", error); }
            finally { polling.set(false); }
        });
    }
}
