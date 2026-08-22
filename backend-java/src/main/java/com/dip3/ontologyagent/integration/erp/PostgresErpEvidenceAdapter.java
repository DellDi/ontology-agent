package com.dip3.ontologyagent.integration.erp;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.EvidenceProvider;
import com.dip3.ontologyagent.tooling.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.tooling.WorkflowRequest;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component("erpEvidenceProvider")
public final class PostgresErpEvidenceAdapter implements EvidenceProvider {
    private final ErpEvidenceMapper mapper;
    private final ScopedProjectResolver scopedProjects;

    public PostgresErpEvidenceAdapter(ErpEvidenceMapper mapper, ScopedProjectResolver scopedProjects) {
        this.mapper = mapper;
        this.scopedProjects = scopedProjects;
    }

    @Override
    public Evidence collect(AuthSession owner, WorkflowRequest request) {
        AnalysisRuntimeCapability.validateKeys(request);
        List<Map<String, Object>> rows = mapper.byProjects(
                scopedProjects.resolve(owner, request.projectIds()).toArray(String[]::new),
                request.from(), request.to()).stream()
                .map(PostgresErpEvidenceAdapter::row).toList();
        return new Evidence("erp-staging", "ERP 范围内收费事实", rows);
    }

    private static Map<String, Object> row(ErpEvidenceRow source) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("projectId", source.projectId);
        row.put("projectName", source.projectName);
        row.put("receivableAmount", source.receivableAmount);
        row.put("paidAmount", source.paidAmount);
        row.put("arrearsAmount", source.arrearsAmount);
        return row;
    }
}
