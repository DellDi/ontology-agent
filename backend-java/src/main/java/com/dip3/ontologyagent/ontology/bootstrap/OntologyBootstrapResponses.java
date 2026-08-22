package com.dip3.ontologyagent.ontology.bootstrap;

import java.util.Map;

public final class OntologyBootstrapResponses {
    private OntologyBootstrapResponses() {}

    public record Status(String state, boolean ready, String currentVersionId, String semver,
                         Map<String, Long> definitionCounts) {}

    public record Result(boolean created, Status status, String correlationId) {}
}
