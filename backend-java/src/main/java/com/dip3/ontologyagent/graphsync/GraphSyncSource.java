package com.dip3.ontologyagent.graphsync;

import java.util.Arrays;
import java.util.List;

public enum GraphSyncSource {
    ORGANIZATIONS("erp.organizations", "organizations-changed"),
    PROJECTS("erp.projects", "projects-changed"),
    OWNERS("erp.owners", "owners-changed"),
    CHARGE_ITEMS("erp.charge_items", "charge-items-changed"),
    RECEIVABLES("erp.receivables", "receivables-changed"),
    PAYMENTS("erp.payments", "payments-changed"),
    SERVICE_ORDERS("erp.service_orders", "service-orders-changed");

    private final String sourceName;
    private final String reason;

    GraphSyncSource(String sourceName, String reason) {
        this.sourceName = sourceName;
        this.reason = reason;
    }

    public String sourceName() { return sourceName; }
    public String reason() { return reason; }

    public static GraphSyncSource require(String value) {
        return Arrays.stream(values()).filter(source -> source.sourceName.equals(value)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("不支持的 Graph Sync source: " + value));
    }

    public static List<String> names() {
        return Arrays.stream(values()).map(GraphSyncSource::sourceName).toList();
    }
}
