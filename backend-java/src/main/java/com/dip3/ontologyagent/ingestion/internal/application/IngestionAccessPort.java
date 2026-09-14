package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import java.time.Instant;
import java.util.List;

public interface IngestionAccessPort {
    record Grant(String sourceKey, String organizationId, String grantedBy, Instant grantedAt) {}
    List<Grant> grants(String organizationId);
    List<String> sourceKeys();
    void setGrant(String sourceKey, String organizationId, boolean enabled, AuthSession actor);
}
