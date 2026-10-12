package com.dip3.ontologyagent.ingestion.internal.application;

import org.springframework.scheduling.support.CronExpression;

import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** One recurring release: what to publish and the wall-clock instants at which it becomes due. */
public final class IngestionSchedule {
    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9-]*");
    private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9_-]*");

    private final String name;
    private final String sourceKey;
    private final List<String> productKeys;
    private final String mode;
    private final CronExpression cron;
    private final ZoneId zone;
    private final Duration catchUp;

    public IngestionSchedule(String name, String sourceKey, List<String> productKeys, String mode,
                             String cron, String zone, Duration catchUp) {
        this.name = require(name, NAME, "name");
        this.sourceKey = require(sourceKey, KEY, "sourceKey");
        if (productKeys == null || productKeys.isEmpty()) {
            throw new IllegalArgumentException("schedule " + name + ": productKeys must not be empty");
        }
        this.productKeys = productKeys.stream().map(key -> require(key, KEY, "productKey")).distinct().sorted().toList();
        // Only recurring refreshes are schedulable; a full snapshot stays an explicit operator decision.
        if (!"incremental".equals(mode) && !"reconcile".equals(mode)) {
            throw new IllegalArgumentException("schedule " + name + ": mode must be incremental or reconcile");
        }
        this.mode = mode;
        if (cron == null || zone == null) {
            throw new IllegalArgumentException("schedule " + name + ": cron and zone are required");
        }
        try {
            this.cron = CronExpression.parse(cron);
            this.zone = ZoneId.of(zone);
        } catch (IllegalArgumentException | DateTimeException error) {
            throw new IllegalArgumentException("schedule " + name + ": invalid cron or zone", error);
        }
        if (catchUp == null || catchUp.isZero() || catchUp.isNegative()) {
            throw new IllegalArgumentException("schedule " + name + ": catchUp must be positive");
        }
        this.catchUp = catchUp;
        ZonedDateTime first = this.cron.next(ZonedDateTime.now(this.zone));
        ZonedDateTime second = first == null ? null : this.cron.next(first);
        if (first == null || second == null || Duration.between(first, second).compareTo(Duration.ofMinutes(1)) < 0) {
            throw new IllegalArgumentException("schedule " + name + ": cron must fire at most once per minute");
        }
    }

    public String name() { return name; }
    public String sourceKey() { return sourceKey; }
    public List<String> productKeys() { return productKeys; }
    public String mode() { return mode; }

    /** The most recent fire in (now - catchUp, now]; older missed fires are deliberately not replayed. */
    public Optional<Instant> latestFire(Instant now) {
        ZonedDateTime next = cron.next(now.minus(catchUp).atZone(zone));
        Instant latest = null;
        while (next != null && !next.toInstant().isAfter(now)) {
            latest = next.toInstant();
            next = cron.next(next);
        }
        return Optional.ofNullable(latest);
    }

    /** Deterministic so every worker replica and restart derives the same task for the same fire. */
    public String taskId(Instant fireTime) {
        return UUID.nameUUIDFromBytes(("scheduled-release:" + name + ":" + fireTime.getEpochSecond())
                .getBytes(StandardCharsets.UTF_8)).toString();
    }

    private static String require(String value, Pattern pattern, String field) {
        if (value == null || !pattern.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must match " + pattern.pattern() + ": " + value);
        }
        return value;
    }
}
