package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@ConditionalOnProperty(prefix = "dip3.graph-sync", name = "enabled", havingValue = "true")
public final class GraphSyncScheduler {
    private static final Logger log = LoggerFactory.getLogger(GraphSyncScheduler.class);
    private final GraphSyncIncrementalService sync;
    private final List<String> sourceNames;

    public GraphSyncScheduler(GraphSyncIncrementalService sync,
                              @Value("${dip3.graph-sync.sources}") List<String> sourceNames) {
        this.sync = sync;
        this.sourceNames = List.copyOf(sourceNames);
    }

    @Scheduled(fixedDelayString = "${dip3.graph-sync.poll-delay}")
    public void runIncrementalSources() {
        for (String sourceName : sourceNames) {
            try {
                sync.runScheduled(sourceName);
            } catch (BackendException error) {
                log.error("graph_sync_source_failed source={} code={} message={}", sourceName, error.code(),
                        error.getMessage(), error);
            } catch (RuntimeException error) {
                log.error("graph_sync_source_failed source={} code=GRAPH_SYNC_INCREMENTAL_FAILED", sourceName,
                        error);
            }
        }
    }
}
