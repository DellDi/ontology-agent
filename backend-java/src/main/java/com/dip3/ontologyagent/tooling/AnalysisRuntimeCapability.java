package com.dip3.ontologyagent.tooling;

import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;

import java.util.List;
import java.util.Map;

public final class AnalysisRuntimeCapability {
    public static final String ENTITY_KEY = "project";
    public static final String METRIC_DEFINITION_KEY = "collection-rate";
    public static final String METRIC_VARIANT_KEY = "project-collection-rate";
    public static final String NUMERATOR_METRIC_VARIANT_KEY = "project-paid-amount";
    public static final String DENOMINATOR_METRIC_VARIANT_KEY = "project-receivable-amount";
    public static final String TIME_SEMANTIC_KEY = "receivable-accounting-period";
    public static final String PAYMENT_TIME_SEMANTIC_KEY = "payment-date";
    public static final String RATIO_FORMULA =
            "project-paid-amount / project-receivable-amount * 100";
    public static final String PAID_AMOUNT_MEASURE = "FinancePayments.paidAmount";
    public static final String RECEIVABLE_AMOUNT_MEASURE = "FinanceReceivables.receivableAmount";
    public static final String RECEIVABLE_PERIOD_DIMENSION =
            "FinanceReceivables.receivableAccountingPeriod";
    public static final String PAYMENT_DATE_DIMENSION = "FinancePayments.paymentDate";

    private static final Map<String, Object> RATIO_MAPPING = Map.of(
            "numeratorMetricKey", NUMERATOR_METRIC_VARIANT_KEY,
            "denominatorMetricKey", DENOMINATOR_METRIC_VARIANT_KEY,
            "formula", RATIO_FORMULA);
    private static final Map<String, Object> PAID_AMOUNT_MAPPING = Map.of("cubeMeasure", PAID_AMOUNT_MEASURE);
    private static final Map<String, Object> RECEIVABLE_AMOUNT_MAPPING =
            Map.of("cubeMeasure", RECEIVABLE_AMOUNT_MEASURE);

    private AnalysisRuntimeCapability() {}

    public static void validate(WorkflowRequest request, OntologyCatalog ontology) {
        validateKeys(request);
        OntologyCatalog.Item parent = find(ontology.metrics(), request.metricDefinitionKey());
        OntologyCatalog.Item variant = find(ontology.metricVariants(), request.metricVariantKey());
        OntologyCatalog.Item numerator = find(ontology.metricVariants(), NUMERATOR_METRIC_VARIANT_KEY);
        OntologyCatalog.Item denominator = find(ontology.metricVariants(), DENOMINATOR_METRIC_VARIANT_KEY);
        OntologyCatalog.Item time = find(ontology.timeSemantics(), request.timeSemanticKey());
        OntologyCatalog.Item paymentTime = find(ontology.timeSemantics(), PAYMENT_TIME_SEMANTIC_KEY);
        boolean governed = find(ontology.entities(), request.entityKey()) != null
                && parent != null
                && applicableTo(parent, request.entityKey())
                && "ratio".equals(parent.metadata().get("defaultAggregation"))
                && "%".equals(parent.metadata().get("unit"))
                && fixedVariant(variant, RATIO_MAPPING)
                && fixedVariant(numerator, PAID_AMOUNT_MAPPING)
                && fixedVariant(denominator, RECEIVABLE_AMOUNT_MAPPING)
                && fixedTime(time, "accounting-period", Map.of("receivable", "shouldAccountBook"),
                RECEIVABLE_PERIOD_DIMENSION, "year")
                && fixedTime(paymentTime, "transaction-date", Map.of("payment", "operatorDate"),
                PAYMENT_DATE_DIMENSION, "month");
        if (!governed) {
            throw new BackendException("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED",
                    "首次 Java 分析仅执行已批准的项目口径收缴率语义链。");
        }
    }

    public static void validateKeys(WorkflowRequest request) {
        if (!ENTITY_KEY.equals(request.entityKey())
                || !METRIC_DEFINITION_KEY.equals(request.metricDefinitionKey())
                || !METRIC_VARIANT_KEY.equals(request.metricVariantKey())
                || !TIME_SEMANTIC_KEY.equals(request.timeSemanticKey())) {
            throw new BackendException("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED",
                    "首次 Java 分析仅执行已批准的项目口径收缴率语义链。");
        }
    }

    public static List<OntologyCatalog.Item> advertised(List<OntologyCatalog.Item> items, String key) {
        return items.stream().filter(item -> key.equals(item.businessKey())).toList();
    }

    private static OntologyCatalog.Item find(List<OntologyCatalog.Item> items, String key) {
        return items.stream().filter(item -> key.equals(item.businessKey())).findFirst().orElse(null);
    }

    private static boolean applicableTo(OntologyCatalog.Item metric, String entityKey) {
        Object value = metric.metadata().get("applicableSubjectKeys");
        return value instanceof List<?> keys && keys.stream().anyMatch(entityKey::equals);
    }

    private static boolean fixedVariant(OntologyCatalog.Item variant, Map<String, Object> cubeViewMapping) {
        return variant != null
                && METRIC_DEFINITION_KEY.equals(variant.metadata().get("parentMetricDefinitionKey"))
                && "project-scope".equals(variant.metadata().get("semanticDiscriminator"))
                && cubeViewMapping.equals(variant.metadata().get("cubeViewMapping"))
                && emptyRule(variant.metadata().get("filterTemplate"));
    }

    private static boolean fixedTime(OntologyCatalog.Item time, String semanticType,
                                     Map<String, Object> entityDateFieldMapping,
                                     String cubeDimension, String defaultGranularity) {
        return time != null
                && semanticType.equals(time.metadata().get("semanticType"))
                && entityDateFieldMapping.equals(time.metadata().get("entityDateFieldMapping"))
                && Map.of("cubeDimension", cubeDimension).equals(time.metadata().get("cubeTimeDimensionMapping"))
                && defaultGranularity.equals(time.metadata().get("defaultGranularity"))
                && emptyRule(time.metadata().get("calculationRule"));
    }

    private static boolean emptyRule(Object value) {
        return value == null || value instanceof Map<?, ?> map && map.isEmpty();
    }
}
