package com.dip3.ontologyagent.graphsync;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.neo4j.Neo4jContainer;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Testcontainers
class Neo4jGraphWriterTest {
    private static final String SET = "property-set-1";
    @Container
    static final Neo4jContainer NEO4J = new Neo4jContainer("neo4j:5.26.12-community")
            .withoutAuthentication();

    @BeforeEach
    void cleanGraph() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            driver.executableQuery("match (n) detach delete n").execute();
        }
    }

    @Test
    void repeatedRebuildIsIdempotentAndCleanupStaysInsideOrganization() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            Neo4jGraphWriter writer = new Neo4jGraphWriter(driver, "neo4j");
            GraphBatch org1Initial = batch("org-1", "run-1", "project-1");
            GraphBatch org2 = batch("org-2", "run-2", "project-2");
            writer.replaceOrganization("org-1", projection(SET), "run-1", 1L, org1Initial);
            writer.replaceOrganization("org-2", projection(SET), "run-2", 2L, org2);
            assertCounts(driver, 4, 2, 2, 1, 1);
            writer.replaceOrganization("org-1", projection(SET), "run-3", 3L, new GraphBatch(
                    List.of(node("organization", "org-1", "org-1", "run-3")), List.of()));
            writer.replaceOrganization("org-1", projection(SET), "run-3", 3L, new GraphBatch(
                    List.of(node("organization", "org-1", "org-1", "run-3")), List.of()));

            assertCounts(driver, 3, 1, 2, 0, 1);
        }
    }

    private static void assertCounts(Driver driver, long nodes, long org1Nodes, long org2Nodes,
                                     long org1Edges, long org2Edges) {
        var result = driver.executableQuery("""
                    match (n:GraphNode)
                    with count(n) as nodes,
                         count(case when n.scope_org_id='org-1' then 1 end) as org1Nodes,
                         count(case when n.scope_org_id='org-2' then 1 end) as org2Nodes
                    optional match ()-[r:GRAPH_EDGE]->()
                    return nodes,org1Nodes,org2Nodes,
                           count(case when r.scope_org_id='org-1' then 1 end) as org1Edges,
                           count(case when r.scope_org_id='org-2' then 1 end) as org2Edges
                    """).execute().records().getFirst();
        assertEquals(nodes, result.get("nodes").asLong());
        assertEquals(org1Nodes, result.get("org1Nodes").asLong());
        assertEquals(org2Nodes, result.get("org2Nodes").asLong());
        assertEquals(org1Edges, result.get("org1Edges").asLong());
        assertEquals(org2Edges, result.get("org2Edges").asLong());
    }

    @Test
    void healthUsesSharedDriverConnectivity() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            assertTrue(new Neo4jHealthIndicator(driver).health().getStatus().getCode().equals("UP"));
        }
    }

    @Test
    void transactionFailureIsFailedNotPartialAndScopeMismatchNeverWrites() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            Neo4jGraphWriter writer = new Neo4jGraphWriter(driver, "missing-database");
            GraphSyncException failed = assertThrows(GraphSyncException.class,
                    () -> writer.replaceOrganization("org-fail", projection(SET), "run-fail", 10L,
                            batch("org-fail", "run-fail", "project-fail")));
            assertFalse(failed.partialWrite());

            GraphSyncException invalid = assertThrows(GraphSyncException.class,
                    () -> new Neo4jGraphWriter(driver, "neo4j").replaceOrganization(
                            "org-a", projection(SET), "run-a", 11L,
                            batch("org-b", "run-b", "project-b")));
            assertEquals("GRAPH_SYNC_BATCH_SCOPE_INVALID", invalid.code());
        }
    }

    @Test
    void monotonicFenceRejectsStaleRunBeforeItCanOverwriteNewProjection() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            Neo4jGraphWriter writer = new Neo4jGraphWriter(driver, "neo4j");
            writer.replaceOrganization("org-fence", projection(SET), "new-run", 200L,
                    batch("org-fence", "new-run", "new-project"));

            GraphSyncException stale = assertThrows(GraphSyncException.class,
                    () -> writer.replaceOrganization("org-fence", projection(SET), "stale-run", 100L,
                            batch("org-fence", "stale-run", "stale-project")));

            assertEquals("GRAPH_SYNC_FENCE_REJECTED", stale.code());
            var ids = driver.executableQuery("""
                    match (n:GraphNode {scope_org_id:'org-fence'}) return collect(n.id) as ids
                    """).execute().records().getFirst().get("ids").asList(org.neo4j.driver.Value::asString);
            assertTrue(ids.contains("new-project"));
            assertFalse(ids.contains("stale-project"));
        }
    }

    @Test
    void keepsHistoricalDatasetVersionSetProjectionIsolated() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            Neo4jGraphWriter writer = new Neo4jGraphWriter(driver, "neo4j");
            writer.replaceOrganization("org-versioned", projection("property-set-old"), "old-run", 10L,
                    batch("org-versioned", "old-run", "old-project", "property-set-old"));
            writer.replaceOrganization("org-versioned", projection("property-set-new"), "new-run", 11L,
                    batch("org-versioned", "new-run", "new-project", "property-set-new"));

            var result = driver.executableQuery("""
                    match (n:GraphNode {scope_org_id:'org-versioned'})
                    return n.dataset_version_set_id as setId,collect(n.id) as ids order by setId
                    """).execute().records();
            assertEquals(2, result.size());
            assertTrue(result.getFirst().get("ids").asList(org.neo4j.driver.Value::asString)
                    .contains("new-project"));
            assertTrue(result.getLast().get("ids").asList(org.neo4j.driver.Value::asString)
                    .contains("old-project"));
        }
    }

    @Test
    void rejectsProductVersionOutsideFrozenProjection() {
        try (Driver driver = GraphDatabase.driver(NEO4J.getBoltUrl())) {
            GraphBatch invalid = batch("org-invalid", "run-invalid", "project-invalid");
            GraphProjection projection = new GraphProjection(SET,
                    Map.of("property-project", "different-version"));

            GraphSyncException error = assertThrows(GraphSyncException.class,
                    () -> new Neo4jGraphWriter(driver, "neo4j").replaceOrganization(
                            "org-invalid", projection, "run-invalid", 20L, invalid));

            assertEquals("GRAPH_SYNC_BATCH_PRODUCT_VERSION_INVALID", error.code());
        }
    }

    private static GraphBatch batch(String organizationId, String runId, String projectId) {
        return batch(organizationId, runId, projectId, SET);
    }

    private static GraphBatch batch(String organizationId, String runId, String projectId, String setId) {
        return new GraphBatch(List.of(node("organization", organizationId, organizationId, runId, setId),
                node("project", projectId, organizationId, runId, setId)), List.of(Map.ofEntries(
                Map.entry("kind", "contains"), Map.entry("fromKind", "organization"),
                Map.entry("fromId", organizationId), Map.entry("toKind", "project"),
                Map.entry("toId", projectId), Map.entry("direction", "outbound"),
                Map.entry("source", "erp"), Map.entry("explanation", "contains"),
                Map.entry("organizationId", organizationId), Map.entry("runId", runId),
                Map.entry("datasetVersionSetId", setId),
                Map.entry("sourceProductKey", "property-project"),
                Map.entry("productVersionId", "project-version-1"))));
    }

    private static Map<String, Object> node(String kind, String id, String organizationId, String runId) {
        return node(kind, id, organizationId, runId, SET);
    }

    private static Map<String, Object> node(String kind, String id, String organizationId,
                                            String runId, String setId) {
        return Map.of("kind", kind, "id", id, "label", id, "organizationId", organizationId,
                "runId", runId, "datasetVersionSetId", setId,
                "sourceProductKey", "property-project", "productVersionId", "project-version-1");
    }

    private static GraphProjection projection(String setId) {
        return new GraphProjection(setId, Map.of("property-project", "project-version-1"));
    }
}
