package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.config.BackendProperties;
import org.neo4j.driver.Driver;
import org.neo4j.driver.SessionConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public final class Neo4jGraphWriter implements GraphWriter {
    static final String DROP_LEGACY_FENCE_CONSTRAINT = """
            drop constraint graph_sync_fence_scope if exists
            """;
    static final String FENCE_CONSTRAINT = """
            create constraint graph_sync_fence_projection if not exists
            for (f:GraphSyncFence) require (f.scope_org_id,f.dataset_version_set_id) is unique
            """;
    static final String PROJECTION_CONSTRAINT = """
            create constraint graph_projection_scope if not exists
            for (p:GraphProjection) require (p.scope_org_id,p.dataset_version_set_id) is unique
            """;
    static final String FENCE = """
            merge (f:GraphSyncFence {scope_org_id:$organizationId,
                                     dataset_version_set_id:$datasetVersionSetId})
            on create set f.generation=-1
            with f,(f.generation<$fencingToken or
                 (f.generation=$fencingToken and f.run_id=$runId)) as accepted
            foreach (_ in case when accepted then [1] else [] end |
              set f.generation=$fencingToken,f.run_id=$runId,f.updated_at=datetime())
            return accepted
            """;
    static final String NODE_MERGE = """
            unwind $nodes as node
            merge (n:GraphNode {scope_org_id:node.organizationId,
                                dataset_version_set_id:node.datasetVersionSetId,
                                kind:node.kind,id:node.id})
            set n.label=node.label,n.scope_org_id=node.organizationId,
                n.dataset_version_set_id=node.datasetVersionSetId,
                n.source_product_key=node.sourceProductKey,
                n.product_version_id=node.productVersionId,
                n.last_seen_run_id=node.runId
            """;
    static final String EDGE_MERGE = """
            unwind $edges as edge
            match (from:GraphNode {scope_org_id:edge.organizationId,
                                   dataset_version_set_id:edge.datasetVersionSetId,
                                   kind:edge.fromKind,id:edge.fromId})
            match (to:GraphNode {scope_org_id:edge.organizationId,
                                 dataset_version_set_id:edge.datasetVersionSetId,
                                 kind:edge.toKind,id:edge.toId})
            merge (from)-[r:GRAPH_EDGE {kind:edge.kind,fromId:edge.fromId,toId:edge.toId}]->(to)
            set r.direction=edge.direction,r.source=edge.source,r.explanation=edge.explanation,
                r.scope_org_id=edge.organizationId,
                r.dataset_version_set_id=edge.datasetVersionSetId,
                r.source_product_key=edge.sourceProductKey,
                r.product_version_id=edge.productVersionId,
                r.last_seen_run_id=edge.runId
            """;
    static final String EDGE_CLEANUP = """
            match ()-[r:GRAPH_EDGE]->()
            where r.scope_org_id=$organizationId
              and r.dataset_version_set_id=$datasetVersionSetId
              and r.last_seen_run_id<>$runId delete r
            """;
    static final String NODE_CLEANUP = """
            match (n:GraphNode {scope_org_id:$organizationId,
                                dataset_version_set_id:$datasetVersionSetId})
            where n.last_seen_run_id<>$runId
              and not exists { match (n)-[r]-()
                               where r.scope_org_id=$organizationId
                                 and r.dataset_version_set_id=$datasetVersionSetId }
            delete n
            """;
    static final String PROJECTION_COMPLETE = """
            merge (p:GraphProjection {scope_org_id:$organizationId,
                                      dataset_version_set_id:$datasetVersionSetId})
            set p.status='complete',p.run_id=$runId,p.product_versions=$productVersions,
                p.completed_at=datetime()
            """;

    private final Driver driver;
    private final String database;
    private volatile boolean fenceConstraintReady;

    @Autowired
    public Neo4jGraphWriter(Driver driver, BackendProperties properties) {
        this(driver, properties.neo4j().database());
    }

    Neo4jGraphWriter(Driver driver, String database) {
        this.driver = driver;
        this.database = database;
    }

    @Override
    public WriteResult replaceOrganization(String organizationId, GraphProjection projection,
                                           String runId, long fencingToken, GraphBatch batch) {
        validateBatch(organizationId, projection, runId, batch);
        String datasetVersionSetId = projection.datasetVersionSetId();
        try {
            var sessionConfig = SessionConfig.builder().withDatabase(database).build();
            ensureFenceConstraint(sessionConfig);
            int[] deleted = new int[2];
            try (var session = driver.session(sessionConfig)) {
                session.executeWrite(tx -> {
                    boolean accepted = tx.run(FENCE, Map.of("organizationId", organizationId,
                            "datasetVersionSetId", datasetVersionSetId,
                            "runId", runId, "fencingToken", fencingToken)).single().get("accepted").asBoolean();
                    if (!accepted) {
                        throw new GraphSyncException("GRAPH_SYNC_FENCE_REJECTED",
                                "该组织已有更新一代的图谱写入，当前 stale run 已拒绝。", false);
                    }
                    tx.run(NODE_MERGE, Map.of("nodes", batch.nodes())).consume();
                    tx.run(EDGE_MERGE, Map.of("edges", batch.edges())).consume();
                    Map<String, Object> cleanup = Map.of("organizationId", organizationId,
                            "datasetVersionSetId", datasetVersionSetId, "runId", runId);
                    deleted[1] = tx.run(EDGE_CLEANUP, cleanup).consume().counters().relationshipsDeleted();
                    deleted[0] = tx.run(NODE_CLEANUP, cleanup).consume().counters().nodesDeleted();
                    tx.run(PROJECTION_COMPLETE, Map.of(
                            "organizationId", organizationId,
                            "datasetVersionSetId", datasetVersionSetId,
                            "runId", runId,
                            "productVersions", projection.productVersionIds().entrySet().stream()
                                    .sorted(Map.Entry.comparingByKey())
                                    .map(entry -> entry.getKey() + "=" + entry.getValue()).toList())).consume();
                    return null;
                });
            }
            return new WriteResult(batch.nodes().size(), batch.edges().size(),
                    deleted[0], deleted[1]);
        } catch (GraphSyncException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new GraphSyncException("NEO4J_GRAPH_SYNC_FAILED", "Neo4j 组织图谱重建失败。",
                    false, error);
        }
    }

    private void ensureFenceConstraint(SessionConfig sessionConfig) {
        if (fenceConstraintReady) return;
        synchronized (this) {
            if (fenceConstraintReady) return;
            try (var session = driver.session(sessionConfig)) {
                session.run(DROP_LEGACY_FENCE_CONSTRAINT).consume();
                session.run(FENCE_CONSTRAINT).consume();
                session.run(PROJECTION_CONSTRAINT).consume();
            }
            fenceConstraintReady = true;
        }
    }

    private static void validateBatch(String organizationId, GraphProjection projection,
                                      String runId, GraphBatch batch) {
        String datasetVersionSetId = projection.datasetVersionSetId();
        for (Map<String, Object> item : java.util.stream.Stream.concat(batch.nodes().stream(), batch.edges().stream())
                .toList()) {
            if (!organizationId.equals(item.get("organizationId"))
                    || !datasetVersionSetId.equals(item.get("datasetVersionSetId"))
                    || !runId.equals(item.get("runId"))) {
                throw new GraphSyncException("GRAPH_SYNC_BATCH_SCOPE_INVALID",
                        "Graph batch scope/run metadata 与目标重建不一致。", false);
            }
            Object productKey = item.get("sourceProductKey");
            Object productVersionId = item.get("productVersionId");
            if (!(productKey instanceof String key)
                    || !projection.productVersionIds().containsKey(key)
                    || !projection.productVersionIds().get(key).equals(productVersionId)) {
                throw new GraphSyncException("GRAPH_SYNC_BATCH_PRODUCT_VERSION_INVALID",
                        "Graph batch 产品版本不属于目标 frozen projection。", false);
            }
        }
    }
}
