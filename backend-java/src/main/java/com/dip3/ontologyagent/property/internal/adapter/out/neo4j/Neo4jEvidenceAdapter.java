package com.dip3.ontologyagent.property.internal.adapter.out.neo4j;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.property.internal.application.EvidenceProvider;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import org.neo4j.driver.Driver;
import org.neo4j.driver.QueryConfig;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component("graphEvidenceProvider")
public final class Neo4jEvidenceAdapter implements EvidenceProvider {
    private static final String CYPHER = """
            match (root:GraphNode {kind:'project',scope_org_id:$organizationId})
            where root.id in $projectIds
            match (root)-[factEdge:GRAPH_EDGE]->(fact:GraphNode)
            where factEdge.kind in ['has-receivable','has-payment']
            match (chargeItem:GraphNode {kind:'charge-item'})-[chargeEdge:GRAPH_EDGE]->(fact)
            where chargeEdge.kind='belongs-to'
            return distinct root.id as rootId,root.label as rootLabel,
                   coalesce(chargeItem.id,chargeItem.label) as factorKey,
                   chargeItem.label as factorLabel,factEdge.kind as factType,
                   chargeEdge.kind as relationType,chargeEdge.direction as direction,
                   factEdge.explanation + '；' + chargeEdge.explanation as explanation,
                   chargeEdge.source as source
            limit 51
            """;
    private final Driver driver;
    private final String database;
    private final ScopedProjectResolver scopedProjects;

    public Neo4jEvidenceAdapter(Driver driver, BackendProperties properties, ScopedProjectResolver scopedProjects) {
        var config = properties.neo4j();
        this.driver = driver;
        this.database = config.database();
        this.scopedProjects = scopedProjects;
    }

    @Override
    public Evidence collect(AuthSession owner, WorkflowRequest request) {
        AnalysisRuntimeCapability.validateKeys(request);
        try {
            var result = driver.executableQuery(CYPHER)
                    .withParameters(Map.of("organizationId", owner.scope().organizationId(),
                            "projectIds", scopedProjects.resolve(owner, request.projectIds())))
                    .withConfig(QueryConfig.builder().withDatabase(database).build()).execute();
            if (result.records().size() > 50) {
                throw new BackendException("NEO4J_RESULT_TRUNCATED", "Neo4j 查询超过 50 条证据上限，禁止截断后生成结论。");
            }
            List<Map<String, Object>> rows = result.records().stream().map(record -> {
                Map<String, Object> row = new LinkedHashMap<>();
                for (String key : result.keys()) row.put(key, record.get(key).isNull() ? null : record.get(key).asObject());
                return row;
            }).toList();
            return new Evidence("neo4j", "受范围约束的收费项目结构关系", rows);
        } catch (BackendException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new BackendException("NEO4J_QUERY_FAILED", "Neo4j 关系证据查询失败。", error);
        }
    }
}
