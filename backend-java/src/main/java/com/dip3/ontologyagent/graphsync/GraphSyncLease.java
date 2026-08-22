package com.dip3.ontologyagent.graphsync;

import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ScheduledFuture;

@Component
public final class GraphSyncLease {
    private final TaskScheduler scheduler;
    private final GraphSyncRunRepository runs;

    public GraphSyncLease(TaskScheduler scheduler, GraphSyncRunRepository runs) {
        this.scheduler = scheduler;
        this.runs = runs;
    }

    public Guard start(String runId) {
        ScheduledFuture<?> future = scheduler.scheduleAtFixedRate(() -> runs.heartbeat(runId),
                Instant.now().plusSeconds(60), Duration.ofMinutes(5));
        return () -> future.cancel(false);
    }

    @FunctionalInterface
    public interface Guard extends AutoCloseable { @Override void close(); }
}
