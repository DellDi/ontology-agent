package com.dip3.ontologyagent.integration.redis;

import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskExecutor;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertTrue;

class RedisWorkerWakeupConfigurationTest {
    @Test
    void wakeupExecutorRunsEveryAdvisoryWakeupOnVirtualThreads() throws Exception {
        RedisWorkerWakeupConfiguration configuration = new RedisWorkerWakeupConfiguration();
        TaskExecutor executor = configuration.analysisWakeExecutor();
        CountDownLatch completed = new CountDownLatch(2);
        AtomicBoolean virtualThreads = new AtomicBoolean(true);

        Runnable wakeup = () -> {
            virtualThreads.compareAndSet(true, Thread.currentThread().isVirtual());
            completed.countDown();
        };
        executor.execute(wakeup);
        executor.execute(wakeup);

        assertTrue(completed.await(1, TimeUnit.SECONDS));
        assertTrue(virtualThreads.get());
    }
}
