package com.dip3.ontologyagent.auth;

public record ViewerResponse(String userId, String displayName, AccessScope scope, boolean workspaceAccess) {
    public static ViewerResponse from(AuthSession session) {
        AccessScope scope = session.scope();
        boolean workspaceAccess = !scope.organizationId().isBlank()
                && (!scope.projectIds().isEmpty() || !scope.areaIds().isEmpty() || !scope.roleCodes().isEmpty());
        return new ViewerResponse(session.userId(), session.displayName(), scope, workspaceAccess);
    }
}
