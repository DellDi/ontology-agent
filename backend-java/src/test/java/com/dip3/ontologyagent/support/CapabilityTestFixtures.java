package com.dip3.ontologyagent.support;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityInvocationContract;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.tooling.Evidence;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class CapabilityTestFixtures {
    public static final CapabilityId PROPERTY_ID = new CapabilityId("property", "collection-rate-analysis");
    public static final CapabilityId EASYV_ID =
            new CapabilityId(EasyVGenerationOntology.DOMAIN_KEY, EasyVGenerationOntology.CAPABILITY_KEY);

    private CapabilityTestFixtures() {}

    public static CapabilityBinding propertyBinding(AuthSession owner, String ontologyVersionId) {
        return new CapabilityBinding(PROPERTY_ID, ontologyVersionId,
                new ResolvedScopeSnapshot(PROPERTY_ID.domainKey(), 1, Map.of(
                        "organizationId", owner.scope().organizationId(),
                        "projectIds", owner.scope().projectIds(),
                        "areaIds", owner.scope().areaIds())));
    }

    public static CapabilityDescriptor propertyDescriptor() {
        return new CapabilityDescriptor(PROPERTY_ID, "物业项目收缴率分析",
                Set.of("project", "collection-rate"),
                PropertyDataProducts.REQUIRED,
                Set.of("erp-staging", "cube", "neo4j"),
                Set.of("collection-rate", "erp-balance", "charge-structure"),
                new CapabilityInvocationContract("workflow-tool", "analysis_workflow", 1,
                        "Main Agent", "Workflow Tool", "workflowInvocations"));
    }

    public static Evidence.Provenance propertyProvenance() {
        return propertyProvenance("ontology-1", "property-set-1");
    }

    public static Evidence.Provenance propertyProvenance(String ontologyVersionId, String datasetVersionSetId) {
        return new Evidence.Provenance(ontologyVersionId, datasetVersionSetId,
                Instant.parse("2026-08-01T03:00:00Z"),
                Map.of(
                        PropertyDataProducts.RECEIVABLE, "receivable-v1",
                        PropertyDataProducts.PAYMENT, "payment-v1",
                        PropertyDataProducts.PROJECT, "project-v1",
                        PropertyDataProducts.CHARGE_ITEM, "charge-item-v1"));
    }

    public static Evidence.Provenance easyvProvenance() {
        return new Evidence.Provenance("ontology-v2", "easyv-set-1",
                Instant.parse("2026-08-01T03:00:00Z"),
                Map.of(
                        "easyv-ai-application", "product-easyv-ai-application",
                        "easyv-prototype-task", "product-easyv-prototype-task",
                        "easyv-pipeline-node", "product-easyv-pipeline-node",
                        "easyv-forge-task", "product-easyv-forge-task",
                        "easyv-generation-feedback", "product-easyv-generation-feedback"));
    }

    public static Evidence evidence(String source, String title, List<Map<String, Object>> rows) {
        return new Evidence(source, title, rows, propertyProvenance());
    }

    public static CapabilityBinding easyvBinding(AuthSession owner, String ontologyVersionId) {
        return new CapabilityBinding(EASYV_ID, ontologyVersionId,
                new ResolvedScopeSnapshot(EASYV_ID.domainKey(), 1, Map.of(
                        "userId", owner.userId(), "accessMode", "creator-owned")));
    }

    public static CapabilityDescriptor easyvDescriptor() {
        return new CapabilityDescriptor(EASYV_ID, "AI 大屏生成质量分析",
                Set.of(EasyVGenerationOntology.ENTITY_KEY, EasyVGenerationOntology.METRIC_KEY,
                        EasyVGenerationOntology.TIME_KEY),
                EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS,
                Set.of("easyv-ai-application", "easyv-pipeline-node", "easyv-forge-task",
                        "easyv-generation-feedback"),
                Set.of("generation-quality", "stage-bottleneck", "failure-concentration",
                        "feedback-association", "business-success-settlement-distinct"),
                EasyVInvocationContract.CONTRACT);
    }
}
