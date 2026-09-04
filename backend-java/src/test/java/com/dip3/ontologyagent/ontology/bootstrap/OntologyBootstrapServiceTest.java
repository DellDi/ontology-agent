package com.dip3.ontologyagent.ontology.bootstrap;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OntologyBootstrapServiceTest {
    @Test
    void legacyValidationTargetsPropertyWhenAnotherDomainIsEnabled() {
        OntologyBootstrapRepository repository = mock(OntologyBootstrapRepository.class);
        OntologyRepository ontologies = mock(OntologyRepository.class);
        CapabilityRegistry capabilities = mock(CapabilityRegistry.class);
        OntologyCatalog legacyCatalog = new OntologyCatalog(
                CanonicalOntologyBaseline.LEGACY_VERSION_ID, CanonicalOntologyBaseline.LEGACY_SEMVER,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        when(repository.snapshot()).thenReturn(new OntologyBootstrapRepository.RegistrySnapshot(
                Map.ofEntries(Map.entry("versions", 1L), Map.entry("entities", 1L), Map.entry("metrics", 1L),
                        Map.entry("metricVariants", 3L), Map.entry("factors", 1L),
                        Map.entry("causalityEdges", 1L), Map.entry("planStepTemplates", 4L),
                        Map.entry("toolBindings", 4L), Map.entry("timeSemantics", 2L),
                        Map.entry("evidenceTypes", 4L), Map.entry("changeRequests", 0L),
                        Map.entry("approvals", 0L), Map.entry("publishes", 1L),
                        Map.entry("groundedContexts", 0L))));
        when(repository.currentVersions()).thenReturn(List.of(new OntologyBootstrapRepository.CurrentVersion(
                CanonicalOntologyBaseline.LEGACY_VERSION_ID, CanonicalOntologyBaseline.LEGACY_SEMVER)));
        when(repository.definitionCounts(CanonicalOntologyBaseline.LEGACY_VERSION_ID))
                .thenReturn(CanonicalOntologyBaseline.legacyMinimumCounts());
        when(repository.integrityIssues(CanonicalOntologyBaseline.LEGACY_VERSION_ID)).thenReturn(List.of());
        when(repository.publishRecordCount(CanonicalOntologyBaseline.LEGACY_VERSION_ID)).thenReturn(1L);
        when(ontologies.published(CanonicalOntologyBaseline.LEGACY_VERSION_ID)).thenReturn(legacyCatalog);

        OntologyBootstrapService service = new OntologyBootstrapService(repository, ontologies, capabilities);

        assertEquals("legacy-ready", service.status(admin()).state());
        verify(capabilities).validateCatalog(legacyCatalog,
                new CapabilityId("property", "collection-rate-analysis"));
    }

    private static AuthSession admin() {
        return new AuthSession("session", "user", "Operator",
                new AccessScope("org", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
    }
}
