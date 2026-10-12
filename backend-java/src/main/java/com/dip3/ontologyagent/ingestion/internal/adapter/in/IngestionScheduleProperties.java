package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionSchedule;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Recurring releases for the release-worker process; nothing is scheduled unless explicitly configured. */
@Component
@ConfigurationProperties("dip3.ingestion.release-worker.schedule")
public class IngestionScheduleProperties {
    private List<Item> items = new ArrayList<>();

    public List<Item> getItems() {
        return items;
    }

    public void setItems(List<Item> items) {
        this.items = items == null ? new ArrayList<>() : items;
    }

    public List<IngestionSchedule> schedules() {
        return items.stream().map(item -> new IngestionSchedule(item.name, item.sourceKey, item.productKeys,
                item.mode, item.cron, item.zone, item.catchUp)).toList();
    }

    public static class Item {
        private String name;
        private String sourceKey;
        private List<String> productKeys = List.of();
        private String mode;
        private String cron;
        private String zone;
        private Duration catchUp = Duration.ofHours(6);

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getSourceKey() { return sourceKey; }
        public void setSourceKey(String sourceKey) { this.sourceKey = sourceKey; }
        public List<String> getProductKeys() { return productKeys; }
        public void setProductKeys(List<String> productKeys) { this.productKeys = productKeys == null ? List.of() : List.copyOf(productKeys); }
        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        public String getCron() { return cron; }
        public void setCron(String cron) { this.cron = cron; }
        public String getZone() { return zone; }
        public void setZone(String zone) { this.zone = zone; }
        public Duration getCatchUp() { return catchUp; }
        public void setCatchUp(Duration catchUp) { this.catchUp = catchUp; }
    }
}
