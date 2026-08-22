package com.dip3.ontologyagent.tooling;

import java.util.List;
import java.util.stream.Collectors;

public record GroundedConclusion(List<Claim> claims) {
    public GroundedConclusion {
        claims = List.copyOf(claims);
    }

    public String text() {
        return claims.stream().map(Claim::text).collect(Collectors.joining("\n\n"));
    }

    public record Claim(String text, List<EvidenceReference> evidenceRefs) {
        public Claim {
            evidenceRefs = List.copyOf(evidenceRefs);
        }
    }

    public record EvidenceReference(String source, int row, String field, Object value) {}
}
