package com.dip3.ontologyagent.ingestion.api;

/**
 * A governed source reference. The definition carries a connection reference,
 * never a connection secret or a raw connection string.
 */
public record SourceDefinition(String sourceKey, String connectorType,
                               String connectionRef, Status status) {
    public SourceDefinition {
        sourceKey = ValueChecks.catalogKey(sourceKey, "sourceKey");
        connectorType = ValueChecks.catalogKey(connectorType, "connectorType");
        connectionRef = ValueChecks.catalogKey(connectionRef, "connectionRef");
        if (status == null) throw new IllegalArgumentException("status must not be null");
    }

    public enum Status {
        ACTIVE,
        DISABLED
    }
}
