package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Set;

@Service
public class IngestionReleaseWorker {
    private static final Logger log = LoggerFactory.getLogger(IngestionReleaseWorker.class);
    private final IngestionReleasePort tasks;
    private final DatasetReleasePublisher publisher;

    public IngestionReleaseWorker(IngestionReleasePort tasks, DatasetReleasePublisher publisher) {
        this.tasks = tasks;
        this.publisher = publisher;
    }

    public void runOne() {
        tasks.withNext(task -> {
            if ("running".equals(task.status())) {
                tasks.recover(task.id(), "INGESTION_RELEASE_INTERRUPTED");
                log.warn("ingestion_release_reconciled taskId={}", task.id());
                return;
            }
            tasks.start(task.id());
            try {
                publisher.publish(new DatasetReleasePublisher.Command(task.id(), task.sourceKey(),
                        Set.copyOf(task.productKeys()), IngestionRun.Mode.valueOf(task.mode().toUpperCase(Locale.ROOT)),
                        task.retryOf() == null ? IngestionRun.TriggerType.MANUAL : IngestionRun.TriggerType.RETRY,
                        task.requestedBy(), task.id(), 2000));
                tasks.finish(task.id(), null);
                log.info("ingestion_release_completed taskId={} traceId={}", task.id(), task.correlationId());
            } catch (RuntimeException error) {
                log.error("ingestion_release_failed taskId={} traceId={}", task.id(), task.correlationId(), error);
                // Publication may have committed before a response/connection failure. Reconcile the
                // actual manifest and unfinished children instead of reporting a false failed release.
                tasks.recover(task.id(), error instanceof com.dip3.ontologyagent.support.BackendException backend
                        ? backend.code() : error instanceof SourceConnectorException connector
                        ? connector.code() : "INGESTION_RELEASE_FAILED");
            }
        });
    }
}
