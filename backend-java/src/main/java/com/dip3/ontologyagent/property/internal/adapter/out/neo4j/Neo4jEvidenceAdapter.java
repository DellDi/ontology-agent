package com.dip3.ontologyagent.property.internal.adapter.out.neo4j;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.property.internal.adapter.out.postgres.PropertyCanonicalScope;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
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
    private static final String READY_CYPHER = """
            match (projection:GraphProjection {scope_org_id:$organizationId,
                  dataset_version_set_id:$datasetVersionSetId,status:'complete'})
            return count(projection) as count
            """;
    private static final String CYPHER = """
            match (root:GraphNode {kind:'project',scope_org_id:$organizationId,
                                   dataset_version_set_id:$datasetVersionSetId})
            where root.id in $projectIds
              and root.source_product_key='property-project'
              and root.product_version_id=$projectProductVersionId
            match (root)-[factEdge:GRAPH_EDGE]->(fact:GraphNode)
            where fact.dataset_version_set_id=$datasetVersionSetId
              and ((factEdge.kind='has-receivable'
                    and factEdge.source_product_key='property-receivable'
                    and factEdge.product_version_id=$receivableProductVersionId
                    and fact.source_product_key='property-receivable'
                    and fact.product_version_id=$receivableProductVersionId)
                or (factEdge.kind='has-payment'
                    and factEdge.source_product_key='property-payment'
                    and factEdge.product_version_id=$paymentProductVersionId
                    and fact.source_product_key='property-payment'
                    and fact.product_version_id=$paymentProductVersionId))
            match (chargeItem:GraphNode {kind:'charge-item',scope_org_id:$organizationId,
                                         dataset_version_set_id:$datasetVersionSetId})
                  -[chargeEdge:GRAPH_EDGE]->(fact)
            where chargeEdge.kind='belongs-to'
              and chargeEdge.dataset_version_set_id=$datasetVersionSetId
              and chargeItem.source_product_key='property-charge-item'
              and chargeItem.product_version_id=$chargeItemProductVersionId
              and ((factEdge.kind='has-receivable'
                    and chargeEdge.source_product_key='property-receivable'
                    and chargeEdge.product_version_id=$receivableProductVersionId)
                or (factEdge.kind='has-payment'
                    and chargeEdge.source_product_key='property-payment'
                    and chargeEdge.product_version_id=$paymentProductVersionId))
            return distinct root.id as rootId,root.label as rootLabel,
                   coalesce(chargeItem.id,chargeItem.label) as factorKey,
                   chargeItem.label as factorLabel,factEdge.kind as factType,
                   chargeEdge.kind as relationType,chargeEdge.direction as direction,
                   factEdge.explanation + '；' + chargeEdge.explanation as explanation,
                   chargeEdge.source as source,$datasetVersionSetId as datasetVersionSetId,
                   fact.product_version_id as factProductVersionId,
                   chargeItem.product_version_id as chargeItemProductVersionId
            limit 51
            """;
    private final Driver driver;
    private final String database;
    private final PropertyCanonicalScope scopes;

    public Neo4jEvidenceAdapter(Driver driver, BackendProperties properties, PropertyCanonicalScope scopes) {
        var config = properties.neo4j();
        this.driver = driver;
        this.database = config.database();
        this.scopes = scopes;
    }

    @Override
    public Evidence collect(AuthSession owner, WorkflowRequest request) {
        AnalysisRuntimeCapability.validateKeys(request);
        PropertyCanonicalScope.Resolved scope = scopes.resolve(owner, request);
        try {
            Map<String, Object> parameters = parameters(owner, scope);
            long ready = driver.executableQuery(READY_CYPHER)
                    .withParameters(parameters)
                    .withConfig(QueryConfig.builder().withDatabase(database).build()).execute()
                    .records().getFirst().get("count").asLong();
            if (ready != 1) {
                throw new BackendException("GRAPH_PROJECTION_NOT_READY",
                        "当前 execution 绑定的物业图投影尚未完成。");
            }
            var result = driver.executableQuery(CYPHER)
                    .withParameters(parameters)
                    .withConfig(QueryConfig.builder().withDatabase(database).build()).execute();
            if (result.records().size() > 50) {
                throw new BackendException("NEO4J_RESULT_TRUNCATED", "Neo4j 查询超过 50 条证据上限，禁止截断后生成结论。");
            }
            List<Map<String, Object>> rows = result.records().stream().map(record -> {
                Map<String, Object> row = new LinkedHashMap<>();
                for (String key : result.keys()) row.put(key, record.get(key).isNull() ? null : record.get(key).asObject());
                return row;
            }).toList();
            return new Evidence("neo4j", "受范围约束的收费项目结构关系", rows,
                    scope.provenance(request.ontologyVersionId(),
                            PropertyDataProducts.PROJECT, PropertyDataProducts.CHARGE_ITEM,
                            PropertyDataProducts.RECEIVABLE, PropertyDataProducts.PAYMENT));
        } catch (BackendException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new BackendException("NEO4J_QUERY_FAILED", "Neo4j 关系证据查询失败。", error);
        }
    }

    private static Map<String, Object> parameters(AuthSession owner,
                                                   PropertyCanonicalScope.Resolved scope) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("organizationId", owner.scope().organizationId());
        result.put("datasetVersionSetId", scope.datasetVersionSetId());
        result.put("projectIds", scope.projectIds());
        result.put("projectProductVersionId", scope.version(PropertyDataProducts.PROJECT));
        result.put("chargeItemProductVersionId", scope.version(PropertyDataProducts.CHARGE_ITEM));
        result.put("receivableProductVersionId", scope.version(PropertyDataProducts.RECEIVABLE));
        result.put("paymentProductVersionId", scope.version(PropertyDataProducts.PAYMENT));
        return Map.copyOf(result);
    }
}
