package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;

import java.time.Instant;
import java.util.Map;

public record AnalysisSession(String id, String ownerUserId, AccessScope scope, String questionText,
                              Map<String, Object> savedContext, String status, Instant createdAt, Instant updatedAt) {
    public boolean accessibleBy(AuthSession viewer) {
        return ownerUserId.equals(viewer.userId())
                && scope.organizationId().equals(viewer.scope().organizationId())
                && viewer.scope().projectIds().containsAll(scope.projectIds())
                && viewer.scope().areaIds().containsAll(scope.areaIds());
    }
}
