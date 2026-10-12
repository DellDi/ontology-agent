package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class IngestionReleaseWorkerTest {
    final IngestionReleasePort tasks = mock(IngestionReleasePort.class);
    final DatasetReleasePublisher publisher = mock(DatasetReleasePublisher.class);
    final IngestionReleaseWorker worker = new IngestionReleaseWorker(tasks, publisher);

    @Test
    void publishesWithTheTriggerTypeRecordedOnTheTask() {
        assertEquals(IngestionRun.TriggerType.SCHEDULED, publishedTrigger("scheduled", "system", null));
        assertEquals(IngestionRun.TriggerType.MANUAL, publishedTrigger("manual", "admin", null));
        assertEquals(IngestionRun.TriggerType.RETRY, publishedTrigger("manual", "admin", "failed-task"));
    }

    private IngestionRun.TriggerType publishedTrigger(String trigger, String requestedBy, String retryOf) {
        reset(tasks, publisher);
        var task = new IngestionReleasePort.Task("task-id", "easyv", List.of("product-a"), "reconcile", trigger,
                "pending", retryOf, requestedBy, "trace", null, Instant.now(), null, null);
        doAnswer(call -> { call.<Consumer<IngestionReleasePort.Task>>getArgument(0).accept(task); return null; })
                .when(tasks).withNext(any());
        worker.runOne();
        var command = ArgumentCaptor.forClass(DatasetReleasePublisher.Command.class);
        verify(publisher).publish(command.capture());
        verify(tasks).finish(eq("task-id"), eq(null));
        assertEquals(requestedBy, command.getValue().triggeredBy());
        return command.getValue().triggerType();
    }
}
