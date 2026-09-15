package com.dip3.ontologyagent.workspace;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.ViewerResponse;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class WorkspaceHomeService {
    private final WorkspaceHomeMapper mapper;
    private final CapabilityRegistry capabilities;

    public WorkspaceHomeService(WorkspaceHomeMapper mapper,
            CapabilityRegistry capabilities) {
        this.mapper = mapper;
        this.capabilities = capabilities;
    }

    public static final int DEFAULT_SESSION_LIMIT = 20;
    public static final int MAX_SESSION_LIMIT = 100;

    @Transactional(readOnly = true)
    public WorkspaceHomeResponse load(AuthSession viewer) {
        return load(viewer, 0, DEFAULT_SESSION_LIMIT);
    }

    @Transactional(readOnly = true)
    public WorkspaceHomeResponse load(AuthSession viewer, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.min(Math.max(1, limit), MAX_SESSION_LIMIT);
        String[] projectIds = viewer.scope().projectIds().toArray(String[]::new);
        String[] areaIds = viewer.scope().areaIds().toArray(String[]::new);
        long total = mapper.countSessions(viewer.userId(), viewer.scope().organizationId(),
                projectIds, areaIds);
        List<WorkspaceHomeMapper.SessionRow> rows = mapper.listSessions(viewer.userId(),
                viewer.scope().organizationId(), projectIds, areaIds, safeLimit, safeOffset);
        Map<String, WorkspaceHomeMapper.ExecutionRow> executions = rows.isEmpty() ? Map.of()
                : mapper.listLatestExecutions(viewer.userId(), viewer.scope().organizationId(),
                        rows.stream().map(row -> row.id).toList()).stream()
                .collect(Collectors.toMap(row -> row.sessionId, Function.identity()));
        List<WorkspaceHomeResponse.SessionSummary> sessions = rows.stream()
                .map(row -> session(row, executions.get(row.id))).toList();
        Map<String, WorkspaceHomeMapper.ProjectRow> projectRows = new LinkedHashMap<>();
        if (projectIds.length > 0) {
            mapper.listProjects(viewer.scope().organizationId(), projectIds)
                    .forEach(row -> projectRows.put(row.id, row));
        }
        if (areaIds.length > 0) {
            mapper.listProjectsByAreas(viewer.scope().organizationId(), areaIds)
                    .forEach(row -> projectRows.putIfAbsent(row.id, row));
        }
        List<WorkspaceHomeResponse.ProjectSummary> projects = projectRows.values().stream()
                .map(row -> new WorkspaceHomeResponse.ProjectSummary(row.id, row.code, row.name,
                        row.organizationId, row.areaId, row.areaName)).toList();
        var page = new WorkspaceHomeResponse.SessionPage(total, safeLimit, safeOffset,
                safeOffset + rows.size() < total);
        return new WorkspaceHomeResponse(ViewerResponse.from(viewer), sessions, page, projects,
                capabilities.availableFor(viewer));
    }

    private static WorkspaceHomeResponse.SessionSummary session(WorkspaceHomeMapper.SessionRow row,
                                                                 WorkspaceHomeMapper.ExecutionRow execution) {
        return new WorkspaceHomeResponse.SessionSummary(row.id, row.questionText, row.status,
                new WorkspaceHomeResponse.SessionScope(row.organizationId, Arrays.asList(row.projectIds),
                        Arrays.asList(row.areaIds)), row.savedContext, row.createdAt, row.updatedAt,
                execution == null ? null : execution(execution));
    }

    private static WorkspaceHomeResponse.LatestExecutionSummary execution(WorkspaceHomeMapper.ExecutionRow row) {
        String status = row.snapshotStatus == null ? row.jobStatus : row.snapshotStatus;
        return new WorkspaceHomeResponse.LatestExecutionSummary(row.executionId, status, row.jobStatus,
                row.snapshotStatus, row.conclusionState, row.capabilityBinding, row.failurePoint, row.errorCode, row.jobError,
                row.traceId, row.createdAt, row.updatedAt);
    }
}
