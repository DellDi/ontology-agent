package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;

import java.util.List;
import java.util.Set;

public record GovernanceCapabilities(boolean canView, boolean canAuthor, boolean canReview, boolean canPublish) {
    private static final String ADMIN = "PLATFORM_ADMIN";

    public static GovernanceCapabilities from(AuthSession actor) {
        List<String> roles = actor.scope().roleCodes();
        boolean admin = roles.contains(ADMIN);
        boolean ontologyRole = roles.stream().anyMatch(Set.of("ONTOLOGY_VIEWER", "ONTOLOGY_AUTHOR",
                "ONTOLOGY_APPROVER", "ONTOLOGY_PUBLISHER")::contains);
        return new GovernanceCapabilities(admin || ontologyRole,
                admin || roles.contains("ONTOLOGY_AUTHOR"), admin || roles.contains("ONTOLOGY_APPROVER"),
                admin || roles.contains("ONTOLOGY_PUBLISHER"));
    }

    void requireView() { require(canView, "查看本体治理"); }
    void requireAuthor() { require(canAuthor, "提交本体变更"); }
    void requireReview() { require(canReview, "审批本体变更"); }
    void requirePublish() { require(canPublish, "发布本体版本"); }

    private static void require(boolean allowed, String action) {
        if (!allowed) throw new BackendException("ONTOLOGY_GOVERNANCE_FORBIDDEN", "当前账号无权" + action + "。");
    }
}
