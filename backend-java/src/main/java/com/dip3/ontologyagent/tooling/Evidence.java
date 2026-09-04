package com.dip3.ontologyagent.tooling;

import java.util.List;
import java.util.Map;

public record Evidence(String source, String title, List<Map<String, Object>> rows) {
    public static List<Map<String, Object>> projection(List<Evidence> evidence) {
        return evidence.stream().map(item -> Map.<String, Object>of(
                "source", item.source(), "title", item.title(),
                "rowCount", item.rows().size(), "rows", item.rows())).toList();
    }
}
