package com.dip3.ontologyagent.graphsync;

import java.util.List;
import java.util.Map;

public record GraphBatch(List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
    public GraphBatch {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
    }
}
