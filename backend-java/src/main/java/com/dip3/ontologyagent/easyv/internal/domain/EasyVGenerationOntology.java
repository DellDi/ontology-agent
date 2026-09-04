package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;

/** Fixed semantic keys accepted by the first EasyV capability. */
public final class EasyVGenerationOntology {
  public static final String DOMAIN_KEY = "easyv";
  public static final String CAPABILITY_KEY = "generation-quality-analysis";
  public static final String ENTITY_KEY = "easyv-ai-application";
  public static final String METRIC_KEY = "easyv-generation-quality";
  public static final String TIME_KEY = "easyv-generation-time";

  private EasyVGenerationOntology() {}

  public static void validate(
      String entityKey, String metricKey, String timeKey, OntologyCatalog ontology) {
    if (ontology == null
        || !ENTITY_KEY.equals(entityKey)
        || !METRIC_KEY.equals(metricKey)
        || !TIME_KEY.equals(timeKey)
        || ontology.entities().stream().noneMatch(item -> ENTITY_KEY.equals(item.businessKey()))
        || ontology.metrics().stream().noneMatch(item -> METRIC_KEY.equals(item.businessKey()))
        || ontology.timeSemantics().stream().noneMatch(item -> TIME_KEY.equals(item.businessKey()))) {
      throw new BackendException(
          "EASYV_ONTOLOGY_SEMANTICS_UNSUPPORTED", "EasyV 生成质量能力未绑定完整的已发布本体语义。");
    }
  }
}
