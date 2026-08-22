package com.dip3.ontologyagent.graphsync;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public final class GraphBatchBuilder {
    private final GraphSyncSourceMapper source;

    public GraphBatchBuilder(GraphSyncSourceMapper source) {
        this.source = source;
    }

    public GraphBatch build(String organizationId, String runId) {
        LinkedHashMap<String, Map<String, Object>> nodes = new LinkedHashMap<>();
        LinkedHashMap<String, Map<String, Object>> edges = new LinkedHashMap<>();
        List<Map<String, Object>> organizations = source.organizations(organizationId);
        if (organizations.stream().noneMatch(row -> organizationId.equals(text(row, "id")))) {
            throw new GraphSyncException("GRAPH_SYNC_ORGANIZATION_NOT_FOUND", "ERP staging 中不存在目标组织。", false);
        }
        for (Map<String, Object> row : organizations) {
            node(nodes, "organization", text(row, "id"), text(row, "label"), organizationId, runId);
            edgeIfPresent(edges, "contains", "organization", text(row, "parent_id"),
                    "organization", text(row, "id"), "erp-master-data", organizationId, runId);
        }
        for (Map<String, Object> row : source.projects(organizationId)) {
            node(nodes, "project", text(row, "id"), text(row, "label"), organizationId, runId);
            edgeIfPresent(edges, "contains", "organization", text(row, "organization_id"),
                    "project", text(row, "id"), "erp-master-data", organizationId, runId);
        }
        for (Map<String, Object> row : source.owners(organizationId)) {
            node(nodes, "owner", text(row, "id"), text(row, "label"), organizationId, runId);
            edgeIfPresent(edges, "has-owner", "project", text(row, "project_id"),
                    "owner", text(row, "id"), "erp-master-data", organizationId, runId);
        }
        for (Map<String, Object> row : source.chargeItems(organizationId)) {
            node(nodes, "charge-item", text(row, "id"), text(row, "label"), organizationId, runId);
        }
        facts(nodes, edges, source.receivables(organizationId), "receivable", "has-receivable",
                organizationId, runId);
        facts(nodes, edges, source.payments(organizationId), "payment", "has-payment",
                organizationId, runId);
        for (Map<String, Object> row : source.serviceOrders(organizationId)) {
            String id = text(row, "id");
            node(nodes, "service-order", id, id, organizationId, runId);
            edgeIfPresent(edges, "has-service-order", "project", text(row, "project_id"),
                    "service-order", id, "erp-derived", organizationId, runId);
            if (Boolean.TRUE.equals(row.get("complaint"))) {
                node(nodes, "complaint", id, "投诉:" + id, organizationId, runId);
                edge(edges, "has-complaint", "service-order", id, "complaint", id,
                        "erp-derived", organizationId, runId);
            }
            if (Boolean.TRUE.equals(row.get("satisfaction"))) {
                node(nodes, "satisfaction", id, "满意度:" + id, organizationId, runId);
                edge(edges, "has-satisfaction", "service-order", id, "satisfaction", id,
                        "erp-derived", organizationId, runId);
            }
        }
        return new GraphBatch(new ArrayList<>(nodes.values()), new ArrayList<>(edges.values()));
    }

    private static void facts(Map<String, Map<String, Object>> nodes, Map<String, Map<String, Object>> edges,
                              List<Map<String, Object>> rows, String kind, String projectEdge,
                              String organizationId, String runId) {
        for (Map<String, Object> row : rows) {
            String id = text(row, "id");
            node(nodes, kind, id, id, organizationId, runId);
            node(nodes, "charge-item", text(row, "charge_item_id"), text(row, "charge_item_label"),
                    organizationId, runId);
            edgeIfPresent(edges, projectEdge, "project", text(row, "project_id"), kind, id,
                    "erp-derived", organizationId, runId);
            edgeIfPresent(edges, "belongs-to", "charge-item", text(row, "charge_item_id"), kind, id,
                    "erp-derived", organizationId, runId);
        }
    }

    private static void node(Map<String, Map<String, Object>> nodes, String kind, String id, String label,
                             String organizationId, String runId) {
        if (id.isBlank()) return;
        nodes.putIfAbsent(kind + ":" + id, Map.of("kind", kind, "id", id,
                "label", label.isBlank() ? id : label, "organizationId", organizationId, "runId", runId));
    }

    private static void edgeIfPresent(Map<String, Map<String, Object>> edges, String kind, String fromKind,
                                      String fromId, String toKind, String toId, String source,
                                      String organizationId, String runId) {
        if (!fromId.isBlank() && !toId.isBlank()) {
            edge(edges, kind, fromKind, fromId, toKind, toId, source, organizationId, runId);
        }
    }

    private static void edge(Map<String, Map<String, Object>> edges, String kind, String fromKind,
                             String fromId, String toKind, String toId, String source,
                             String organizationId, String runId) {
        Map<String, Object> edge = Map.of("kind", kind, "fromKind", fromKind, "fromId", fromId,
                "toKind", toKind, "toId", toId, "direction", "outbound", "source", source,
                "explanation", fromKind + " -> " + toKind, "organizationId", organizationId, "runId", runId);
        edges.put(kind + ":" + fromKind + ":" + fromId + ":" + toKind + ":" + toId, edge);
    }

    private static String text(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? "" : value.toString().trim();
    }
}
