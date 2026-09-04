package com.dip3.ontologyagent.capability.api;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CapabilityEnvelopeTest {
    @Test
    void resultOnlyAcceptsEvidenceFromTheSameBindingAndScope() {
        CapabilityBinding binding = binding("property", "ontology-1");
        CapabilityEvidence<Map<String, Object>> evidence = new CapabilityEvidence<>(binding, "execution-1",
                "cube", "cube", Map.of("value", 80));

        CapabilityResult<String, Map<String, Object>> result = new CapabilityResult<>(binding, "execution-1",
                "result", List.of(evidence));

        assertEquals("result", result.result());
        assertEquals(List.of(evidence), result.evidence());
    }

    @Test
    void crossCapabilityEvidenceIsRejectedBeforePersistence() {
        CapabilityBinding property = binding("property", "ontology-1");
        CapabilityBinding another = binding("another", "ontology-1");
        CapabilityEvidence<Map<String, Object>> evidence = new CapabilityEvidence<>(another, "execution-1",
                "other", "other", Map.of("value", 1));

        assertThrows(IllegalArgumentException.class,
                () -> new CapabilityResult<>(property, "execution-1", "result", List.of(evidence)));
    }

    @Test
    void propertyResultRejectsEasyVEvidenceFromTheSameOntologyVersion() {
        CapabilityBinding property = binding("property", "collection-rate-analysis", "ontology-1");
        CapabilityBinding easyv = binding("easyv", "generation-quality-analysis", "ontology-1");
        CapabilityEvidence<Map<String, Object>> evidence = new CapabilityEvidence<>(easyv, "execution-1",
                "easyv-ai-application", "easyv", Map.of("count", 1));

        assertThrows(IllegalArgumentException.class,
                () -> new CapabilityResult<>(property, "execution-1", "result", List.of(evidence)));
    }

    @Test
    void easyVResultRejectsPropertyEvidenceFromTheSameOntologyVersion() {
        CapabilityBinding easyv = binding("easyv", "generation-quality-analysis", "ontology-1");
        CapabilityBinding property = binding("property", "collection-rate-analysis", "ontology-1");
        CapabilityEvidence<Map<String, Object>> evidence = new CapabilityEvidence<>(property, "execution-1",
                "cube", "property", Map.of("count", 1));

        assertThrows(IllegalArgumentException.class,
                () -> new CapabilityResult<>(easyv, "execution-1", "result", List.of(evidence)));
    }

    private static CapabilityBinding binding(String domain, String ontologyVersion) {
        return binding(domain, "analysis", ontologyVersion);
    }

    private static CapabilityBinding binding(String domain, String capability, String ontologyVersion) {
        return new CapabilityBinding(new CapabilityId(domain, capability), ontologyVersion,
                new ResolvedScopeSnapshot(domain, 1, Map.of("scope", "scope-1")));
    }
}
