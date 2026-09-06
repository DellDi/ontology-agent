package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.internal.application.DatasetReleasePublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.IntConsumer;

/** One-shot input adapter for a governed source-to-canonical release. */
@Component
@Profile("ingest")
public final class DatasetReleaseIngestionRunner implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DatasetReleaseIngestionRunner.class);

    private final DatasetReleasePublisher publisher;
    private final IngestionRunnerProperties properties;
    private final IntConsumer exit;

    @Autowired
    public DatasetReleaseIngestionRunner(DatasetReleasePublisher publisher,
                                         IngestionRunnerProperties properties) {
        this(publisher, properties, System::exit);
    }

    DatasetReleaseIngestionRunner(DatasetReleasePublisher publisher,
                                  IngestionRunnerProperties properties,
                                  IntConsumer exit) {
        this.publisher = publisher;
        this.properties = properties;
        this.exit = exit;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        DatasetReleasePublisher.Result release;
        try {
            release = publisher.publish(command());
        } catch (Exception error) {
            log.error("ingestion_release_failed message={}", error.getMessage(), error);
            exit.accept(1);
            throw error;
        }

        log.info("ingestion_release_complete sourceRunId={} publicationId={} productKeys={}",
                release.sourceRunId(), release.versionSet().publicationId(),
                release.productVersions().keySet().stream().sorted().toList());
        exit.accept(0);
    }

    DatasetReleasePublisher.Command command() {
        String sourceKey = required(properties.getSourceKey(), "sourceKey");
        Set<String> productKeys = productKeys(properties.getProductKeys());
        IngestionRun.Mode mode = mode(properties.getMode());
        IngestionRun.TriggerType trigger = trigger(properties.getTrigger());
        String requestedBy = properties.getRequestedBy() == null
                ? "ingest" : required(properties.getRequestedBy(), "requestedBy");
        String requestId = optional(properties.getRequestId());
        String publicationId = optional(properties.getPublicationId());
        if (publicationId == null) {
            publicationId = "ingest-" + UUID.randomUUID();
        }
        return new DatasetReleasePublisher.Command(
                publicationId, sourceKey, productKeys, mode, trigger,
                requestedBy, requestId, properties.getPageSize());
    }

    private static Set<String> productKeys(List<String> values) {
        if (values == null || values.isEmpty()) {
            throw new IllegalArgumentException("productKeys must not be empty");
        }
        Set<String> keys = new LinkedHashSet<>();
        for (String value : values) {
            String key = required(value, "productKey");
            if (!keys.add(key)) {
                throw new IllegalArgumentException("productKeys must not contain duplicates: " + key);
            }
        }
        return Set.copyOf(keys);
    }

    private static IngestionRun.Mode mode(String value) {
        String normalized = required(value, "mode").toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "FULL" -> IngestionRun.Mode.FULL;
            case "INCREMENTAL" -> IngestionRun.Mode.INCREMENTAL;
            default -> throw new IllegalArgumentException(
                    "mode must be FULL or INCREMENTAL: " + value);
        };
    }

    private static IngestionRun.TriggerType trigger(String value) {
        String normalized = required(value, "trigger").toUpperCase(Locale.ROOT);
        try {
            return IngestionRun.TriggerType.valueOf(normalized);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("unsupported trigger: " + value, error);
        }
    }

    private static String required(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value.trim();
    }

    private static String optional(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
