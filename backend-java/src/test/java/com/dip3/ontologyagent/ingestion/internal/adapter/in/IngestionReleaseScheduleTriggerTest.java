package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleaseService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

class IngestionReleaseScheduleTriggerTest {
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties
    @Import({IngestionScheduleProperties.class, IngestionReleaseScheduleTrigger.class})
    static class Context {
        @Bean IngestionReleaseService releases() { return mock(IngestionReleaseService.class); }
    }

    private static final String P = "dip3.ingestion.release-worker.";
    private final ApplicationContextRunner runner = new ApplicationContextRunner().withUserConfiguration(Context.class);

    private static String[] daily(String... extra) {
        var base = new String[] {
                P + "enabled=true", P + "schedule.enabled=true",
                P + "schedule.items[0].name=easyv-daily-reconcile", P + "schedule.items[0].source-key=easyv",
                P + "schedule.items[0].product-keys=easyv-a,easyv-b", P + "schedule.items[0].mode=reconcile",
                P + "schedule.items[0].cron=0 0 2 * * *", P + "schedule.items[0].zone=Asia/Shanghai"};
        var all = java.util.Arrays.copyOf(base, base.length + extra.length);
        System.arraycopy(extra, 0, all, base.length, extra.length);
        return all;
    }

    @Test
    void nothingIsScheduledUnlessBothTheWorkerAndTheScheduleAreEnabled() {
        runner.run(context -> assertTrue(context.getBeansOfType(IngestionReleaseScheduleTrigger.class).isEmpty()));
        runner.withPropertyValues(P + "schedule.enabled=true").run(context ->
                assertTrue(context.getBeansOfType(IngestionReleaseScheduleTrigger.class).isEmpty()));
        runner.withPropertyValues(P + "enabled=true").run(context ->
                assertTrue(context.getBeansOfType(IngestionReleaseScheduleTrigger.class).isEmpty()));
    }

    @Test
    void bindsScheduleItemsWithDefaultsAndRegistersTheTrigger() {
        runner.withPropertyValues(daily()).run(context -> {
            assertEquals(1, context.getBeansOfType(IngestionReleaseScheduleTrigger.class).size());
            var schedule = context.getBean(IngestionScheduleProperties.class).schedules().getFirst();
            assertEquals(java.util.List.of("easyv-a", "easyv-b"), schedule.productKeys());
            assertEquals("reconcile", schedule.mode());
        });
    }

    @Test
    void misconfigurationFailsStartupInsteadOfSilentlyNeverRunning() {
        runner.withPropertyValues(P + "enabled=true", P + "schedule.enabled=true").run(context ->
                assertTrue(context.getStartupFailure().getMessage().contains("Error creating bean")));
        runner.withPropertyValues(daily(P + "schedule.items[0].cron=not a cron")).run(context ->
                assertTrue(rootMessage(context.getStartupFailure()).contains("invalid cron or zone")));
        runner.withPropertyValues(daily(P + "schedule.items[0].mode=full")).run(context ->
                assertTrue(rootMessage(context.getStartupFailure()).contains("mode must be incremental or reconcile")));
        runner.withPropertyValues(daily(P + "schedule.items[0].zone=")).run(context ->
                assertTrue(context.getStartupFailure() != null));
    }

    private static String rootMessage(Throwable failure) {
        var message = new StringBuilder();
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) message.append(cause.getMessage()).append('\n');
        return message.toString();
    }
}
