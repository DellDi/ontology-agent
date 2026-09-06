package com.dip3.ontologyagent.property.internal.adapter.out.neo4j;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.property.internal.adapter.out.postgres.PropertyCanonicalScope;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.neo4j.Neo4jContainer;

@Testcontainers
class Neo4jEvidenceAdapterTest {
  @Container
  static final Neo4jContainer NEO4J = new Neo4jContainer("neo4j:5.26.12-community")
      .withoutAuthentication();

  private final Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl());

  @BeforeEach
  void reset() {
    driver.executableQuery("match (n) detach delete n").execute();
  }

  @Test
  void readsOnlyTheExecutionPinnedGraphProjection() {
    seed("property-set-old", "old-item", "old-receivable");
    seed("property-set-new", "new-item", "new-receivable");
    AuthSession owner = owner();
    WorkflowRequest request = request("property-set-old");
    PropertyCanonicalScope scopes = mock(PropertyCanonicalScope.class);
    when(scopes.resolve(owner, request)).thenReturn(new PropertyCanonicalScope.Resolved(
        "property-set-old", versions(), List.of("project-1")));
    Neo4jEvidenceAdapter adapter = new Neo4jEvidenceAdapter(driver, properties(), scopes);

    var rows = adapter.collect(owner, request).rows();

    assertEquals(1, rows.size());
    assertEquals("old-item", rows.getFirst().get("factorKey"));
    assertEquals("has-receivable", rows.getFirst().get("factType"));
  }

  @Test
  void failsLoudWhenExecutionProjectionIsNotReady() {
    AuthSession owner = owner();
    WorkflowRequest request = request("property-set-missing");
    PropertyCanonicalScope scopes = mock(PropertyCanonicalScope.class);
    when(scopes.resolve(owner, request)).thenReturn(new PropertyCanonicalScope.Resolved(
        "property-set-missing", versions(), List.of("project-1")));

    var error = org.junit.jupiter.api.Assertions.assertThrows(
        com.dip3.ontologyagent.support.BackendException.class,
        () -> new Neo4jEvidenceAdapter(driver, properties(), scopes).collect(owner, request));

    assertEquals("GRAPH_PROJECTION_NOT_READY", error.code());
  }

  private void seed(String setId, String chargeItemId, String factId) {
    driver.executableQuery("""
        create (:GraphProjection {scope_org_id:'org-1',dataset_version_set_id:$setId,status:'complete'})
        create (project:GraphNode {kind:'project',id:'project-1',label:'项目一',
          scope_org_id:'org-1',dataset_version_set_id:$setId,
          source_product_key:'property-project',product_version_id:'project-v1'})
        create (item:GraphNode {kind:'charge-item',id:$chargeItemId,label:$chargeItemId,
          scope_org_id:'org-1',dataset_version_set_id:$setId,
          source_product_key:'property-charge-item',product_version_id:'charge-item-v1'})
        create (fact:GraphNode {kind:'receivable',id:$factId,label:$factId,
          scope_org_id:'org-1',dataset_version_set_id:$setId,
          source_product_key:'property-receivable',product_version_id:'receivable-v1'})
        create (project)-[:GRAPH_EDGE {kind:'has-receivable',direction:'outbound',
          source:'canonical-derived',explanation:'project -> receivable',
          dataset_version_set_id:$setId,source_product_key:'property-receivable',
          product_version_id:'receivable-v1'}]->(fact)
        create (item)-[:GRAPH_EDGE {kind:'belongs-to',direction:'outbound',
          source:'canonical-derived',explanation:'charge-item -> receivable',
          dataset_version_set_id:$setId,source_product_key:'property-receivable',
          product_version_id:'receivable-v1'}]->(fact)
        """).withParameters(Map.of("setId", setId, "chargeItemId", chargeItemId, "factId", factId))
        .execute();
  }

  private static Map<String, String> versions() {
    return Map.of(
        PropertyDataProducts.PROJECT, "project-v1",
        PropertyDataProducts.CHARGE_ITEM, "charge-item-v1",
        PropertyDataProducts.RECEIVABLE, "receivable-v1",
        PropertyDataProducts.PAYMENT, "payment-v1");
  }

  private static AuthSession owner() {
    return new AuthSession("session-1", "user-1", "用户",
        new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
  }

  private static WorkflowRequest request(String setId) {
    return new WorkflowRequest("execution-1", "session-1", "ontology-1", setId,
        "分析项目收缴率", AnalysisRuntimeCapability.ENTITY_KEY,
        AnalysisRuntimeCapability.METRIC_DEFINITION_KEY,
        AnalysisRuntimeCapability.METRIC_VARIANT_KEY,
        AnalysisRuntimeCapability.TIME_SEMANTIC_KEY, List.of("project-1"),
        LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31), "lease-1",
        "java-initial-v1", null, null, Map.of(), Map.of());
  }

  private static BackendProperties properties() {
    return new BackendProperties("session-secret", "dip3",
        new BackendProperties.Cube("http://cube", "cube-secret", Duration.ofSeconds(1)),
        new BackendProperties.Neo4j(NEO4J.getBoltUrl(), "neo4j", "password", "neo4j"),
        new BackendProperties.Worker(false, Duration.ofSeconds(1)),
        new BackendProperties.Stream(Duration.ofMillis(10), Duration.ofSeconds(1)),
        "", "", false, false, false);
  }
}
