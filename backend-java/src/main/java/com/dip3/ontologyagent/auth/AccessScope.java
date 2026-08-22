package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.support.BackendException;

import java.util.List;

public record AccessScope(String organizationId, List<String> projectIds, List<String> areaIds, List<String> roleCodes) {
    public AccessScope {
        if (organizationId == null || organizationId.isBlank()) {
            throw new BackendException("AUTH_SCOPE_INVALID", "组织范围不能为空。");
        }
        projectIds = List.copyOf(projectIds);
        areaIds = List.copyOf(areaIds);
        roleCodes = List.copyOf(roleCodes);
    }
}
