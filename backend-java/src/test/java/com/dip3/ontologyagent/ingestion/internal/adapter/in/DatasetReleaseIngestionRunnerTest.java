package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.internal.application.DatasetReleasePublisher;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatasetReleaseIngestionRunnerTest {
    private static final List<String> DEFAULT_PRODUCTS = List.of(
            "easyv-ai-application",
            "easyv-prototype-task",
            "easyv-pipeline-node",
            "easyv-forge-task",
            "easyv-generation-feedback");

    @Test
    void requiresAnExplicitDomainReleaseSelection() {
        IngestionRunnerProperties properties = new IngestionRunnerProperties();
        DatasetReleasePublisher publisher = mock(DatasetReleasePublisher.class);
        DatasetReleaseIngestionRunner runner = new DatasetReleaseIngestionRunner(
                publisher, properties, ignored -> { });

        assertThrows(IllegalArgumentException.class, runner::command);

        properties.setSourceKey("easyv");
        properties.setProductKeys(DEFAULT_PRODUCTS);
        var command = runner.command();
        assertEquals("easyv", command.sourceKey());
        assertEquals(DEFAULT_PRODUCTS.stream().sorted().toList(),
                command.productKeys().stream().sorted().toList());
        assertEquals(com.dip3.ontologyagent.ingestion.api.IngestionRun.Mode.FULL, command.mode());
        assertEquals(com.dip3.ontologyagent.ingestion.api.IngestionRun.TriggerType.MANUAL, command.triggerType());
        assertEquals("ingest", command.triggeredBy());
        assertEquals(2_000, command.pageSize());
    }

    @Test
    void rejectsUnsupportedModeAndInvalidProductSelection() {
        IngestionRunnerProperties properties = new IngestionRunnerProperties();
        DatasetReleasePublisher publisher = mock(DatasetReleasePublisher.class);
        DatasetReleaseIngestionRunner runner = new DatasetReleaseIngestionRunner(
                publisher, properties, ignored -> { });

        properties.setMode("RECONCILE");
        assertThrows(IllegalArgumentException.class, runner::command);

        properties.setMode("FULL");
        properties.setProductKeys(List.of("easyv", "easyv"));
        assertThrows(IllegalArgumentException.class, runner::command);
    }

    @Test
    void publishesExactlyOnceAndExitsSuccessfully() throws Exception {
        DatasetReleasePublisher publisher = mock(DatasetReleasePublisher.class);
        IngestionRunnerProperties properties = easyVProperties();
        Instant now = Instant.parse("2026-09-05T00:00:00Z");
        DatasetVersionSet versionSet = new DatasetVersionSet(
                "set-1", Map.of(), now, DatasetVersionSet.Status.FROZEN, now, now, "ingest");
        DatasetReleasePublisher.Result result = new DatasetReleasePublisher.Result(
                "source-run-1", Map.of(), Map.of(), versionSet);
        when(publisher.publish(any())).thenReturn(result);
        List<Integer> exits = new ArrayList<>();
        DatasetReleaseIngestionRunner runner = new DatasetReleaseIngestionRunner(
                publisher, properties, exits::add);

        runner.run(null);

        verify(publisher, times(1)).publish(any());
        assertEquals(List.of(0), exits);
    }

    @Test
    void propagatesFailureAndExitsWithNonZeroCode() {
        DatasetReleasePublisher publisher = mock(DatasetReleasePublisher.class);
        RuntimeException failure = new IllegalStateException("source unavailable");
        when(publisher.publish(any())).thenThrow(failure);
        List<Integer> exits = new ArrayList<>();
        DatasetReleaseIngestionRunner runner = new DatasetReleaseIngestionRunner(
                publisher, easyVProperties(), exits::add);

        RuntimeException thrown = assertThrows(RuntimeException.class, () -> runner.run(null));

        assertSame(failure, thrown);
        assertEquals(List.of(1), exits);
        verify(publisher, times(1)).publish(any());
    }

    private static IngestionRunnerProperties easyVProperties() {
        IngestionRunnerProperties properties = new IngestionRunnerProperties();
        properties.setSourceKey("easyv");
        properties.setProductKeys(DEFAULT_PRODUCTS);
        return properties;
    }
}
