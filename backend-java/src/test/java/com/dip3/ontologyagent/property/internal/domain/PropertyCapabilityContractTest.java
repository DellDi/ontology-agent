package com.dip3.ontologyagent.property.internal.domain;

import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PropertyCapabilityContractTest {
    private static final String UNSUPPORTED = "ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED";

    @Test
    void freezesTheCurrentPropertyCapabilityIdentity() {
        assertEquals("project", AnalysisRuntimeCapability.ENTITY_KEY);
        assertEquals("collection-rate", AnalysisRuntimeCapability.METRIC_DEFINITION_KEY);
        assertEquals("project-collection-rate", AnalysisRuntimeCapability.METRIC_VARIANT_KEY);
        assertEquals("project-paid-amount", AnalysisRuntimeCapability.NUMERATOR_METRIC_VARIANT_KEY);
        assertEquals("project-receivable-amount", AnalysisRuntimeCapability.DENOMINATOR_METRIC_VARIANT_KEY);
        assertEquals("receivable-accounting-period", AnalysisRuntimeCapability.TIME_SEMANTIC_KEY);
        assertEquals("payment-date", AnalysisRuntimeCapability.PAYMENT_TIME_SEMANTIC_KEY);
        assertEquals("project-paid-amount / project-receivable-amount * 100",
                AnalysisRuntimeCapability.RATIO_FORMULA);
    }

    @Test
    void acceptsOnlyTheExactPropertyRuntimeKeys() {
        assertDoesNotThrow(() -> AnalysisRuntimeCapability.validateKeys(request(
                "project", "collection-rate", "project-collection-rate", "receivable-accounting-period")));

        assertUnsupported(request("organization", "collection-rate", "project-collection-rate",
                "receivable-accounting-period"));
        assertUnsupported(request("project", "receivable-amount", "project-collection-rate",
                "receivable-accounting-period"));
        assertUnsupported(request("project", "collection-rate", "organization-collection-rate",
                "receivable-accounting-period"));
        assertUnsupported(request("project", "collection-rate", "project-collection-rate", "payment-date"));
    }

    @Test
    void acceptsTheCompleteGovernedPropertyCatalogAndRejectsMetadataDrift() {
        WorkflowRequest request = request("project", "collection-rate", "project-collection-rate",
                "receivable-accounting-period");
        OntologyCatalog approved = propertyCatalog();

        assertDoesNotThrow(() -> AnalysisRuntimeCapability.validate(request, approved));

        OntologyCatalog drifted = new OntologyCatalog(approved.versionId(), approved.semver(),
                approved.entities(), List.of(new OntologyCatalog.Item("collection-rate", "收缴率", Map.of(
                "applicableSubjectKeys", List.of("project"),
                "defaultAggregation", "ratio",
                "unit", "decimal"))), approved.metricVariants(), approved.factors(),
                approved.timeSemantics(), approved.planSteps(), approved.toolBindings());
        BackendException error = assertThrows(BackendException.class,
                () -> AnalysisRuntimeCapability.validate(request, drifted));
        assertEquals(UNSUPPORTED, error.code());
    }

    @Test
    void advertisedIsOnlyAKeyProjectionAfterCatalogValidation() {
        OntologyCatalog approved = propertyCatalog();
        AnalysisRuntimeCapability.validate(request("project", "collection-rate", "project-collection-rate",
                "receivable-accounting-period"), approved);
        List<OntologyCatalog.Item> items = List.of(approved.entities().getFirst(),
                new OntologyCatalog.Item("organization", "组织", Map.of()));

        assertEquals(List.of(items.getFirst()),
                AnalysisRuntimeCapability.advertised(items, AnalysisRuntimeCapability.ENTITY_KEY));
        assertEquals(List.of(), AnalysisRuntimeCapability.advertised(items, "unknown"));
    }

    private static OntologyCatalog propertyCatalog() {
        return new OntologyCatalog("ontology-1", "1.0.0",
                List.of(new OntologyCatalog.Item("project", "项目", Map.of())),
                List.of(new OntologyCatalog.Item("collection-rate", "收缴率", Map.of(
                        "applicableSubjectKeys", List.of("project"),
                        "defaultAggregation", "ratio",
                        "unit", "%"))),
                List.of(
                        metricVariant("project-collection-rate", Map.of(
                                "numeratorMetricKey", "project-paid-amount",
                                "denominatorMetricKey", "project-receivable-amount",
                                "formula", "project-paid-amount / project-receivable-amount * 100")),
                        metricVariant("project-paid-amount",
                                Map.of("cubeMeasure", "FinancePayments.paidAmount")),
                        metricVariant("project-receivable-amount",
                                Map.of("cubeMeasure", "FinanceReceivables.receivableAmount"))),
                List.of(),
                List.of(
                        timeSemantic("receivable-accounting-period", "accounting-period",
                                Map.of("receivable", "shouldAccountBook"),
                                "FinanceReceivables.receivableAccountingPeriod", "year"),
                        timeSemantic("payment-date", "transaction-date",
                                Map.of("payment", "operatorDate"), "FinancePayments.paymentDate", "month")),
                List.of(), List.of());
    }

    private static OntologyCatalog.Item metricVariant(String key, Map<String, Object> cubeViewMapping) {
        return new OntologyCatalog.Item(key, key, Map.of(
                "parentMetricDefinitionKey", "collection-rate",
                "semanticDiscriminator", "project-scope",
                "cubeViewMapping", cubeViewMapping));
    }

    private static OntologyCatalog.Item timeSemantic(String key, String semanticType,
                                                     Map<String, Object> entityDateFieldMapping,
                                                     String cubeDimension, String defaultGranularity) {
        return new OntologyCatalog.Item(key, key, Map.of(
                "semanticType", semanticType,
                "entityDateFieldMapping", entityDateFieldMapping,
                "cubeTimeDimensionMapping", Map.of("cubeDimension", cubeDimension),
                "defaultGranularity", defaultGranularity));
    }

    private static void assertUnsupported(WorkflowRequest request) {
        BackendException error = assertThrows(BackendException.class,
                () -> AnalysisRuntimeCapability.validateKeys(request));
        assertEquals(UNSUPPORTED, error.code());
    }

    private static WorkflowRequest request(String entityKey, String metricDefinitionKey,
                                           String metricVariantKey, String timeSemanticKey) {
        return new WorkflowRequest("execution-1", "session-1", "ontology-1",
                entityKey, metricDefinitionKey, metricVariantKey, timeSemanticKey,
                List.of("project-1"), LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"), "lease-1");
    }
}
