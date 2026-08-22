package com.dip3.ontologyagent.execution;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.lang.management.ManagementFactory;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
@ConditionalOnProperty(prefix = "dip3.worker", name = "enabled", havingValue = "true")
public final class WorkerScheduler {
    private final AnalysisWorker worker;
    private final String workerId = ManagementFactory.getRuntimeMXBean().getName() + "-" + UUID.randomUUID();
    private final AtomicBoolean polling = new AtomicBoolean();

    public WorkerScheduler(AnalysisWorker worker) {
        this.worker = worker;
    }

    @Scheduled(fixedDelayString = "${dip3.worker.poll-delay}")
    public void reconcileQueuedJob() {
        runOnce();
    }

    public void wake() {
        runOnce();
    }

    private void runOnce() {
        if (!polling.compareAndSet(false, true)) return;
        try {
            worker.runOne(workerId);
        } finally {
            polling.set(false);
        }
    }
}
