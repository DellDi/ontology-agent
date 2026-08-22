package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GovernanceCapabilitiesTest {
    @Test
    void grantsOnlyTheDeclaredGovernanceRoles() {
        GovernanceCapabilities viewer = GovernanceCapabilities.from(actor("ONTOLOGY_VIEWER"));
        assertTrue(viewer.canView());
        assertFalse(viewer.canAuthor());
        assertFalse(viewer.canReview());
        assertFalse(viewer.canPublish());

        GovernanceCapabilities author = GovernanceCapabilities.from(actor("ONTOLOGY_AUTHOR"));
        assertTrue(author.canView());
        assertTrue(author.canAuthor());
        assertFalse(author.canReview());
        assertFalse(author.canPublish());

        GovernanceCapabilities approver = GovernanceCapabilities.from(actor("ONTOLOGY_APPROVER"));
        assertTrue(approver.canView());
        assertFalse(approver.canAuthor());
        assertTrue(approver.canReview());
        assertFalse(approver.canPublish());

        GovernanceCapabilities publisher = GovernanceCapabilities.from(actor("ONTOLOGY_PUBLISHER"));
        assertTrue(publisher.canView());
        assertFalse(publisher.canAuthor());
        assertFalse(publisher.canReview());
        assertTrue(publisher.canPublish());

        GovernanceCapabilities admin = GovernanceCapabilities.from(actor("PLATFORM_ADMIN"));
        assertTrue(admin.canView());
        assertTrue(admin.canAuthor());
        assertTrue(admin.canReview());
        assertTrue(admin.canPublish());
    }

    @Test
    void unknownOntologyPrefixDoesNotCreateAViewerRole() {
        GovernanceCapabilities unknown = GovernanceCapabilities.from(actor("ONTOLOGY_INTRUDER"));
        assertFalse(unknown.canView());
        BackendException error = assertThrows(BackendException.class, unknown::requireView);
        assertEquals("ONTOLOGY_GOVERNANCE_FORBIDDEN", error.code());
    }

    private static AuthSession actor(String role) {
        return new AuthSession("session", "user", "用户",
                new AccessScope("org", List.of(), List.of(), List.of(role)), Instant.MAX);
    }
}
