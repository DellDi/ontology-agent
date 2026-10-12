package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class IngestionScheduleServiceTest {
    final IngestionReleaseService releases = mock(IngestionReleaseService.class);
    final IngestionSchedule daily = IngestionScheduleTest.daily(Duration.ofHours(6));
    final IngestionSchedule hourly = new IngestionSchedule("easyv-hourly", "easyv", List.of("product-a"), "incremental",
            "0 0 * * * *", "UTC", Duration.ofMinutes(30));
    final Instant dailyFire = Instant.parse("2026-10-12T18:00:00Z");

    private static IngestionReleasePort.ScheduledSubmission enqueued() {
        return new IngestionReleasePort.ScheduledSubmission(new IngestionReleasePort.Task("task", "easyv",
                List.of("product-a"), "reconcile", "scheduled", "pending", null, "system", "trace", null,
                Instant.parse("2026-10-12T18:00:00Z"), null, null), null);
    }

    @Test
    void enqueuesEachFireExactlyOnceAcrossTicks() {
        var service = new IngestionScheduleService(releases, List.of(daily));
        when(releases.submitScheduled(any(), any())).thenReturn(enqueued());
        service.runDue(Instant.parse("2026-10-12T17:59:59Z"));
        verifyNoInteractions(releases);
        service.runDue(dailyFire.plusSeconds(1));
        service.runDue(dailyFire.plusSeconds(31));
        verify(releases, times(1)).submitScheduled(daily, dailyFire);
        service.runDue(dailyFire.plusSeconds(86_400 + 5));
        verify(releases).submitScheduled(daily, dailyFire.plusSeconds(86_400));
        verifyNoMoreInteractions(releases);
    }

    @Test
    void afterRestartCatchesUpOnlyWithinTheWindowAndReplaysAreIdempotentAtTheStore() {
        when(releases.submitScheduled(any(), any())).thenReturn(enqueued());
        new IngestionScheduleService(releases, List.of(daily)).runDue(dailyFire.plus(Duration.ofHours(5)));
        verify(releases).submitScheduled(daily, dailyFire);
        reset(releases);
        new IngestionScheduleService(releases, List.of(daily)).runDue(dailyFire.plus(Duration.ofHours(7)));
        verifyNoInteractions(releases);
    }

    @Test
    void anEquivalentActiveReleaseSkipsTheFireWithoutRetryingIt() {
        var service = new IngestionScheduleService(releases, List.of(daily));
        when(releases.submitScheduled(any(), any())).thenReturn(new IngestionReleasePort.ScheduledSubmission(null, "active-task"));
        service.runDue(dailyFire.plusSeconds(1));
        service.runDue(dailyFire.plusSeconds(31));
        verify(releases, times(1)).submitScheduled(daily, dailyFire);
    }

    @Test
    void deterministicRejectionIsLoggedOnceAndDoesNotBlockOtherSchedules() {
        var service = new IngestionScheduleService(releases, List.of(daily, hourly));
        Instant now = Instant.parse("2026-10-12T18:00:10Z");
        when(releases.submitScheduled(eq(daily), any())).thenThrow(new BackendException("INGESTION_PRODUCT_UNAVAILABLE", "disabled"));
        when(releases.submitScheduled(eq(hourly), any())).thenReturn(enqueued());
        service.runDue(now);
        service.runDue(now.plusSeconds(30));
        verify(releases, times(1)).submitScheduled(eq(daily), any());
        verify(releases, times(1)).submitScheduled(eq(hourly), any());
    }

    @Test
    void transientInfrastructureFailureIsRetriedOnTheNextTickUntilItSucceeds() {
        var service = new IngestionScheduleService(releases, List.of(daily));
        when(releases.submitScheduled(any(), any())).thenThrow(new QueryTimeoutException("db down")).thenReturn(enqueued());
        service.runDue(dailyFire.plusSeconds(1));
        service.runDue(dailyFire.plusSeconds(31));
        service.runDue(dailyFire.plusSeconds(61));
        verify(releases, times(2)).submitScheduled(daily, dailyFire);
    }

    @Test
    void duplicateScheduleNamesAreRejectedAtStartup() {
        assertThrows(IllegalArgumentException.class, () -> new IngestionScheduleService(releases, List.of(daily, daily)));
    }
}
