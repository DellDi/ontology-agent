package com.dip3.ontologyagent.ingestion.internal.application;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class IngestionScheduleTest {
    static IngestionSchedule daily(Duration catchUp) {
        return new IngestionSchedule("easyv-daily-reconcile", "easyv", List.of("product-b", "product-a", "product-a"),
                "reconcile", "0 0 2 * * *", "Asia/Shanghai", catchUp);
    }

    @Test
    void firesAreEvaluatedInTheScheduleZoneAndOnlyTheLatestOneWithinCatchUpIsReturned() {
        var schedule = daily(Duration.ofHours(6));
        // 02:00 Asia/Shanghai == 18:00Z of the previous day.
        assertEquals(Optional.of(Instant.parse("2026-10-12T18:00:00Z")), schedule.latestFire(Instant.parse("2026-10-12T18:30:00Z")));
        assertEquals(Optional.of(Instant.parse("2026-10-12T18:00:00Z")), schedule.latestFire(Instant.parse("2026-10-12T18:00:00Z")));
        assertEquals(Optional.of(Instant.parse("2026-10-12T18:00:00Z")), schedule.latestFire(Instant.parse("2026-10-12T23:59:59Z")));
        assertEquals(Optional.empty(), schedule.latestFire(Instant.parse("2026-10-12T17:59:59Z")));
        // The catch-up window is open at its lower bound: exactly 6h after the fire it is no longer replayed.
        assertEquals(Optional.empty(), schedule.latestFire(Instant.parse("2026-10-13T00:00:00Z")));
        assertEquals(Optional.empty(), schedule.latestFire(Instant.parse("2026-10-13T00:00:01Z")));
    }

    @Test
    void frequentCronReturnsOnlyTheMostRecentMissedFireNotTheWholeBacklog() {
        var hourly = new IngestionSchedule("easyv-hourly", "easyv", List.of("product-a"), "incremental",
                "0 0 * * * *", "UTC", Duration.ofHours(6));
        assertEquals(Optional.of(Instant.parse("2026-10-12T10:00:00Z")), hourly.latestFire(Instant.parse("2026-10-12T10:30:00Z")));
    }

    @Test
    void productKeysAreSortedAndDistinctSoEquivalentConfigurationsShareIdentity() {
        assertEquals(List.of("product-a", "product-b"), daily(Duration.ofHours(1)).productKeys());
    }

    @Test
    void taskIdIsAStableStandardUuidPerScheduleAndFireTime() {
        var schedule = daily(Duration.ofHours(1));
        Instant fire = Instant.parse("2026-10-12T18:00:00Z");
        String id = schedule.taskId(fire);
        assertEquals(id, schedule.taskId(fire));
        assertEquals(id, UUID.fromString(id).toString());
        assertNotEquals(id, schedule.taskId(fire.plusSeconds(86_400)));
        assertNotEquals(id, new IngestionSchedule("easyv-other", "easyv", List.of("product-a"), "reconcile",
                "0 0 2 * * *", "Asia/Shanghai", Duration.ofHours(1)).taskId(fire));
    }

    @Test
    void invalidConfigurationFailsLoudlyAtConstruction() {
        Duration grace = Duration.ofHours(1);
        List<String> products = List.of("product-a");
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("Bad Name", "easyv", products, "reconcile", "0 0 2 * * *", "UTC", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "BAD", products, "reconcile", "0 0 2 * * *", "UTC", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "easyv", List.of(), "reconcile", "0 0 2 * * *", "UTC", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "easyv", products, "full", "0 0 2 * * *", "UTC", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "easyv", products, "reconcile", "not a cron", "UTC", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "easyv", products, "reconcile", "* * * * * *", "UTC", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "easyv", products, "reconcile", "0 0 2 * * *", "Mars/Base", grace));
        assertThrows(IllegalArgumentException.class, () -> new IngestionSchedule("n", "easyv", products, "reconcile", "0 0 2 * * *", "UTC", Duration.ZERO));
    }
}
