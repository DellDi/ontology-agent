package com.dip3.ontologyagent.ingestion.internal.application;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Fixed code registry for trusted source protocol implementations. */
public final class SourceConnectorRegistry {
    private final Map<String, SourceConnector> connectors;

    public SourceConnectorRegistry(List<SourceConnector> connectors) {
        if (connectors == null || connectors.isEmpty()
                || connectors.stream().anyMatch(connector -> connector == null)) {
            throw new IllegalArgumentException("connectors must not be null or empty");
        }
        Map<String, SourceConnector> indexed = new LinkedHashMap<>();
        for (SourceConnector connector : connectors) {
            String type = connector.connectorType();
            if (type == null || !type.matches("[a-z][a-z0-9_-]*")) {
                throw new IllegalArgumentException("connectorType must be a restricted catalog key");
            }
            if (indexed.putIfAbsent(type, connector) != null) {
                throw new IllegalArgumentException("duplicate source connector type: " + type);
            }
        }
        this.connectors = Map.copyOf(indexed);
    }

    public SourceConnector require(String connectorType) {
        SourceConnector connector = connectors.get(connectorType);
        if (connector == null) {
            throw new SourceConnectorException("SOURCE_CONNECTOR_TYPE_UNSUPPORTED",
                    "no trusted connector is registered for type " + connectorType);
        }
        return connector;
    }
}
