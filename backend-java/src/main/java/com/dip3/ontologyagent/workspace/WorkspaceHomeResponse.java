package com.dip3.ontologyagent.workspace;

import com.dip3.ontologyagent.auth.ViewerResponse;
import com.dip3.ontologyagent.capability.api.CapabilityAvailability;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record WorkspaceHomeResponse(ViewerResponse viewer, List<SessionSummary> sessions,
                                    SessionPage sessionPage,
                                    List<ProjectSummary> projects,
                                    List<CapabilityAvailability> capabilities) {
    public record SessionPage(long total, int limit, int offset, boolean hasMore) {}
    public record SessionSummary(String id, String questionText, String status, SessionScope scope,
                                 Map<String, Object> savedContext, Instant createdAt, Instant updatedAt,
                                 LatestExecutionSummary latestExecution) {}

    public record SessionScope(String organizationId, List<String> projectIds, List<String> areaIds) {}

    public record LatestExecutionSummary(String executionId, String status, String jobStatus,
                                         String snapshotStatus, Map<String, Object> conclusionState,
                                         Map<String, Object> capabilityBinding,
                                         Map<String, Object> failurePoint, String errorCode, String jobError,
                                         String traceId, Instant createdAt, Instant updatedAt) {}

    public record ProjectSummary(String id, String code, String name, String organizationId,
                                 String areaId, String areaName) {}
}
