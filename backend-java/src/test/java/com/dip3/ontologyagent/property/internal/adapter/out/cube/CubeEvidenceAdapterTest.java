package com.dip3.ontologyagent.property.internal.adapter.out.cube;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.integration.cube.OntologyMetricVariantEntity;
import com.dip3.ontologyagent.integration.cube.OntologyMetricVariantMapper;
import com.dip3.ontologyagent.integration.cube.OntologyTimeSemanticEntity;
import com.dip3.ontologyagent.integration.cube.OntologyTimeSemanticMapper;
import com.dip3.ontologyagent.property.internal.adapter.out.postgres.PropertyCanonicalScope;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CubeEvidenceAdapterTest {
    @Test
    void sumsTheNumericStringsReturnedByCube() {
        assertEquals(125.5, CubeEvidenceAdapter.total(List.of(
                Map.of("FinancePayments.paidAmount", "100.25"),
                Map.of("FinancePayments.paidAmount", 25.25)), "FinancePayments.paidAmount"));
    }

    @Test
    void rejectsNonNumericMeasureValues() {
        BackendException error = assertThrows(BackendException.class, () -> CubeEvidenceAdapter.total(
                List.of(Map.of("FinancePayments.paidAmount", "not-a-number")),
                "FinancePayments.paidAmount"));
        assertEquals("CUBE_RESPONSE_INVALID", error.code());
    }

    @Test
    void roundsGovernedRatioToFourDecimalPlaces() {
        assertEquals(33.3333, CubeEvidenceAdapter.ratio(1, 3));
        assertEquals(0, CubeEvidenceAdapter.ratio(CubeEvidenceAdapter.total(List.of(), "unused"), 100));
    }

    @Test
    void rejectsZeroAndNegativeDenominators() {
        for (double denominator : List.of(0d, -1d)) {
            BackendException error = assertThrows(BackendException.class,
                    () -> CubeEvidenceAdapter.ratio(1, denominator));
            assertEquals("CUBE_RATIO_DENOMINATOR_INVALID", error.code());
        }
    }

    @Test
    void rejectsRowsForProjectsOutsideTheRequestedScope() {
        BackendException error = assertThrows(BackendException.class,
                () -> CubeEvidenceAdapter.requireScopedProject(
                        Map.of("FinanceReceivables.projectId", "project-2"),
                        "FinanceReceivables.projectId", List.of("project-1")));
        assertEquals("CUBE_SCOPE_VIOLATION", error.code());
    }

    @Test
    void addsTheExecutionPinnedProductVersionFilterToEveryCubeLoad() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        List<String> requests = new CopyOnWriteArrayList<>();
        server.createContext("/cubejs-api/v1/load", exchange -> {
            requests.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = ("{\"data\":[{\"FinancePayments.paidAmount\":\"100\","
                    + "\"FinanceReceivables.receivableAmount\":\"200\","
                    + "\"FinancePayments.projectId\":\"project-1\","
                    + "\"FinancePayments.projectName\":\"项目一\","
                    + "\"FinanceReceivables.projectId\":\"project-1\","
                    + "\"FinanceReceivables.projectName\":\"项目一\"}]}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        try {
            PropertyCanonicalScope canonicalScope = mock(PropertyCanonicalScope.class);
            when(canonicalScope.resolve(any(), any())).thenReturn(resolvedScope());
            OntologyMetricVariantMapper metrics = mock(OntologyMetricVariantMapper.class);
            when(metrics.selectOne(any(QueryWrapper.class))).thenReturn(
                    metric("project-collection-rate", null,
                            "project-paid-amount", "project-receivable-amount",
                            AnalysisRuntimeCapability.RATIO_FORMULA),
                    metric("project-paid-amount", "FinancePayments.paidAmount", null, null, null),
                    metric("project-receivable-amount", "FinanceReceivables.receivableAmount", null, null, null));
            OntologyTimeSemanticMapper times = mock(OntologyTimeSemanticMapper.class);
            when(times.selectOne(any(QueryWrapper.class))).thenReturn(
                    time("receivable-accounting-period", "FinanceReceivables.receivableAccountingPeriod",
                            "accounting-period", Map.of("receivable", "shouldAccountBook"), "year"),
                    time("payment-date", "FinancePayments.paymentDate", "transaction-date",
                            Map.of("payment", "operatorDate"), "month"));

            CubeEvidenceAdapter adapter = new CubeEvidenceAdapter(metrics, times, new JsonCodec(), canonicalScope,
                    properties(server.getAddress().getPort()));
            adapter.collect(owner(), request("set-1"));

            assertEquals(2, requests.size());
            assertTrue(requests.stream().anyMatch(body -> body.contains(
                    "\"member\":\"FinancePayments.productVersionId\"")
                    && body.contains("payment-v1")));
            assertTrue(requests.stream().anyMatch(body -> body.contains(
                    "\"member\":\"FinanceReceivables.productVersionId\"")
                    && body.contains("receivable-v1")));
            verify(canonicalScope).resolve(any(), any());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsAnUnboundDatasetVersionSetBeforeCallingCube() {
        OntologyMetricVariantMapper metrics = mock(OntologyMetricVariantMapper.class);
        OntologyTimeSemanticMapper times = mock(OntologyTimeSemanticMapper.class);
        PropertyCanonicalScope canonicalScope = mock(PropertyCanonicalScope.class);
        when(canonicalScope.resolve(any(), any())).thenThrow(new BackendException(
                "DATASET_VERSION_SET_MISSING", "Cube 查询未绑定 canonical 数据版本集合。"));
        CubeEvidenceAdapter adapter = new CubeEvidenceAdapter(metrics, times, new JsonCodec(), canonicalScope,
                properties(1));

        BackendException error = assertThrows(BackendException.class,
                () -> adapter.collect(owner(), request(null)));

        assertEquals("DATASET_VERSION_SET_MISSING", error.code());
        verify(canonicalScope).resolve(any(), any());
        verifyNoInteractions(metrics, times);
    }

    private static OntologyMetricVariantEntity metric(String businessKey, String cubeMeasure,
                                                       String numerator, String denominator, String formula) {
        OntologyMetricVariantEntity row = new OntologyMetricVariantEntity();
        row.ontologyVersionId = "ontology-1";
        row.businessKey = businessKey;
        row.status = "approved";
        row.parentMetricDefinitionId = "collection-rate";
        row.semanticDiscriminator = "project-scope";
        var mapping = new java.util.LinkedHashMap<String, Object>();
        if (cubeMeasure != null) mapping.put("cubeMeasure", cubeMeasure);
        if (numerator != null) mapping.put("numeratorMetricKey", numerator);
        if (denominator != null) mapping.put("denominatorMetricKey", denominator);
        if (formula != null) mapping.put("formula", formula);
        row.cubeViewMapping = mapping;
        return row;
    }

    private static OntologyTimeSemanticEntity time(String businessKey, String cubeDimension,
                                                    String semanticType, Map<String, Object> fields,
                                                    String granularity) {
        OntologyTimeSemanticEntity row = new OntologyTimeSemanticEntity();
        row.ontologyVersionId = "ontology-1";
        row.businessKey = businessKey;
        row.status = "approved";
        row.semanticType = semanticType;
        row.entityDateFieldMapping = fields;
        row.cubeTimeDimensionMapping = Map.of("cubeDimension", cubeDimension);
        row.defaultGranularity = granularity;
        return row;
    }

    private static PropertyCanonicalScope.Resolved resolvedScope() {
        return new PropertyCanonicalScope.Resolved("set-1", Map.of(
                PropertyDataProducts.ORGANIZATION, "organization-v1",
                PropertyDataProducts.PROJECT, "project-v1",
                PropertyDataProducts.CHARGE_ITEM, "charge-item-v1",
                PropertyDataProducts.RECEIVABLE, "receivable-v1",
                PropertyDataProducts.PAYMENT, "payment-v1",
                PropertyDataProducts.SERVICE_ORDER, "service-order-v1"), List.of("project-1"),
                Instant.parse("2026-08-01T03:00:00Z"));
    }

    private static AuthSession owner() {
        return new AuthSession("session-1", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    }

    private static WorkflowRequest request(String datasetVersionSetId) {
        return new WorkflowRequest("execution-1", "session-1", "ontology-1", datasetVersionSetId,
                "分析项目收缴率", AnalysisRuntimeCapability.ENTITY_KEY,
                AnalysisRuntimeCapability.METRIC_DEFINITION_KEY,
                AnalysisRuntimeCapability.METRIC_VARIANT_KEY,
                AnalysisRuntimeCapability.TIME_SEMANTIC_KEY, List.of("project-1"),
                LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31), "lease-1",
                ExecutionRepository.EXECUTION_CONTRACT, null, null, Map.of(), Map.of());
    }

    private static BackendProperties properties(int port) {
        return new BackendProperties("session-secret", "dip3",
                new BackendProperties.Cube("http://127.0.0.1:" + port + "/cubejs-api/v1", "cube-secret",
                        Duration.ofSeconds(1)),
                new BackendProperties.Neo4j("bolt://neo4j", "neo4j", "password", "neo4j"),
                new BackendProperties.Worker(false, Duration.ofSeconds(1)),
                new BackendProperties.Stream(Duration.ofMillis(10), Duration.ofSeconds(1)),
                "", "", false, false, false);
    }
}
