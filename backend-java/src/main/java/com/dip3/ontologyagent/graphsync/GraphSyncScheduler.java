package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@ConditionalOnProperty(prefix = "dip3.graph-sync", name = "enabled", havingValue = "true")
public final class GraphSyncScheduler {
    private static final Logger log = LoggerFactory.getLogger(GraphSyncScheduler.class);
    private final GraphSyncBootstrapService sync;

    public GraphSyncScheduler(GraphSyncBootstrapService sync) {
        this.sync = sync;
    }

    @Scheduled(fixedDelayString = "${dip3.graph-sync.poll-delay}")
    public void rebuildPublishedProjection() {
        try {
            sync.runIfOutdated("graph-sync-scheduler-" + UUID.randomUUID());
        } catch (BackendException error) {
            log.error("graph_sync_projection_failed code={} message={}", error.code(), error.getMessage(), error);
        } catch (RuntimeException error) {
            log.error("graph_sync_projection_failed code=GRAPH_SYNC_BOOTSTRAP_FAILED", error);
        }
    }
}
