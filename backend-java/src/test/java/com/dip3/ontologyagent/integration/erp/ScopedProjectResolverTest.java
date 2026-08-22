package com.dip3.ontologyagent.integration.erp;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScopedProjectResolverTest {
    private final ErpEvidenceMapper mapper = mock(ErpEvidenceMapper.class);
    private final ScopedProjectResolver resolver = new ScopedProjectResolver(mapper);

    @Test
    void keepsExplicitProjectScope() {
        assertEquals(List.of("project-1"), resolver.resolve(owner(List.of("project-1"), List.of())));
    }

    @Test
    void resolvesAreaScopeToProjects() {
        when(mapper.projectIdsByAreas("org-1", new String[]{"area-1"}))
                .thenReturn(List.of("project-2"));

        assertEquals(List.of("project-2"), resolver.resolve(owner(List.of(), List.of("area-1"))));
        verify(mapper).projectIdsByAreas("org-1", new String[]{"area-1"});
    }

    @Test
    void combinesDirectAndAreaProjectScopeWithoutDuplicates() {
        when(mapper.projectIdsByAreas("org-1", new String[]{"area-1"}))
                .thenReturn(List.of("project-2", "project-1"));

        assertEquals(List.of("project-1", "project-2"),
                resolver.resolve(owner(List.of("project-1"), List.of("area-1"))));
    }

    @Test
    void rejectsAnAreaThatResolvesToNoProjects() {
        when(mapper.projectIdsByAreas("org-1", new String[]{"area-1"})).thenReturn(List.of());

        BackendException error = assertThrows(BackendException.class,
                () -> resolver.resolve(owner(List.of(), List.of("area-1"))));
        assertEquals("ERP_SCOPE_RESOLUTION_EMPTY", error.code());
    }

    @Test
    void resolvesEveryAuthorizedProjectToAnAgentVisibleName() {
        when(mapper.projectTargets(new String[]{"project-1"}))
                .thenReturn(List.of(new ScopedProjectTarget("project-1", "项目一")));

        assertEquals(List.of(new ScopedProjectTarget("project-1", "项目一")),
                resolver.targets(owner(List.of("project-1"), List.of())));
    }

    @Test
    void rejectsAnIncompleteProjectDirectoryInsteadOfLettingTheAgentGuess() {
        when(mapper.projectTargets(new String[]{"project-1"})).thenReturn(List.of());

        BackendException error = assertThrows(BackendException.class,
                () -> resolver.targets(owner(List.of("project-1"), List.of())));
        assertEquals("ERP_SCOPE_RESOLUTION_INCOMPLETE", error.code());
    }

    private static AuthSession owner(List<String> projects, List<String> areas) {
        return new AuthSession("session-1", "user-1", "User",
                new AccessScope("org-1", projects, areas, List.of("analyst")), Instant.MAX);
    }
}
