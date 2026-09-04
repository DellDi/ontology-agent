package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.ontology.OntologyCatalog;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;

public record EasyVGenerationRequest(
    String executionContract,
    String executionId,
    String sessionId,
    String questionText,
    String ontologyVersionId,
    String entityKey,
    String metricKey,
    String timeKey,
    OntologyCatalog ontology,
    LocalDate from,
    LocalDate to,
    String userId,
    String accessMode,
    Map<String, Object> effectiveContext,
    Instant requestedAt) {
  public EasyVGenerationRequest {
    effectiveContext = effectiveContext == null ? Map.of() : Map.copyOf(effectiveContext);
  }
}
