package com.dip3.ontologyagent.workspace;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.ViewerResponse;
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

    public WorkspaceHomeService(WorkspaceHomeMapper mapper) {
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public WorkspaceHomeResponse load(AuthSession viewer) {
        String[] projectIds = viewer.scope().projectIds().toArray(String[]::new);
        String[] areaIds = viewer.scope().areaIds().toArray(String[]::new);
        List<WorkspaceHomeMapper.SessionRow> rows = mapper.listSessions(viewer.userId(),
                viewer.scope().organizationId(), projectIds, areaIds);
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
        return new WorkspaceHomeResponse(ViewerResponse.from(viewer), sessions, projects);
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
                row.snapshotStatus, row.conclusionState, row.failurePoint, row.errorCode, row.jobError,
                row.traceId, row.createdAt, row.updatedAt);
    }
}
