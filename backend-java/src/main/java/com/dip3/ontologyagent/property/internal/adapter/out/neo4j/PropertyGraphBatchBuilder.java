package com.dip3.ontologyagent.property.internal.adapter.out.neo4j;

import com.dip3.ontologyagent.graphsync.GraphBatch;
import com.dip3.ontologyagent.graphsync.GraphBatchBuilder;
import com.dip3.ontologyagent.graphsync.GraphProjection;
import com.dip3.ontologyagent.graphsync.GraphSyncException;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.support.BackendException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Builds the Property relationship projection exclusively from canonical facts. */
@Component
public final class PropertyGraphBatchBuilder implements GraphBatchBuilder {
  private final JdbcTemplate jdbc;
  private final DatasetVersionSetRegistry versionSets;
  private final TransactionTemplate readOnly;

  public PropertyGraphBatchBuilder(JdbcTemplate jdbc, DatasetVersionSetRegistry versionSets,
                                   PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.versionSets = versionSets;
    this.readOnly = new TransactionTemplate(transactionManager);
    this.readOnly.setReadOnly(true);
    this.readOnly.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
  }

  @Override
  public GraphProjection latestProjection() {
    DatasetVersionSet set = versionSets.latestFrozen(PropertyDataProducts.REQUIRED)
        .orElseThrow(() -> new BackendException("PROPERTY_DATASET_VERSION_SET_NOT_FOUND",
            "尚无完整且已冻结的物业 canonical 数据版本集合。"));
    return projection(set);
  }

  @Override
  public GraphProjection requireProjection(String datasetVersionSetId) {
    return projection(versionSets.requireFrozen(datasetVersionSetId, PropertyDataProducts.REQUIRED));
  }

  @Override
  public List<String> activeOrganizationIds(GraphProjection projection) {
    requirePropertyProjection(projection);
    List<String> result = readOnly.execute(status -> {
      assertReadOnly();
      return jdbc.queryForList("""
          select organization_id::text
          from facts.property_organization
          where product_version_id=? and not is_deleted
          order by organization_id
          """, String.class, version(projection, PropertyDataProducts.ORGANIZATION));
    });
    if (result == null) {
      throw new BackendException("PROPERTY_GRAPH_SOURCE_READ_FAILED",
          "物业 canonical 组织范围读取失败。");
    }
    return result;
  }

  @Override
  public GraphBatch build(String organizationId, String runId, GraphProjection projection) {
    requirePropertyProjection(projection);
    GraphBatch result = readOnly.execute(status -> buildReadOnly(organizationId, runId, projection));
    if (result == null) {
      throw new BackendException("PROPERTY_GRAPH_SOURCE_READ_FAILED",
          "物业 canonical 图投影读取失败。");
    }
    return result;
  }

  private GraphBatch buildReadOnly(String organizationId, String runId, GraphProjection projection) {
    assertReadOnly();
    LinkedHashMap<String, Map<String, Object>> nodes = new LinkedHashMap<>();
    LinkedHashMap<String, Map<String, Object>> edges = new LinkedHashMap<>();
    String setId = projection.datasetVersionSetId();
    String organizationVersion = version(projection, PropertyDataProducts.ORGANIZATION);

    List<Map<String, Object>> organizations = jdbc.queryForList("""
        with recursive scoped_orgs as (
          select organization_id,parent_organization_id,organization_name
          from facts.property_organization
          where product_version_id=? and organization_id::text=? and not is_deleted
          union all
          select child.organization_id,child.parent_organization_id,child.organization_name
          from facts.property_organization child
          join scoped_orgs parent on child.parent_organization_id=parent.organization_id
          where child.product_version_id=? and not child.is_deleted
        )
        select organization_id::text id,organization_name label,
               parent_organization_id::text parent_id
        from scoped_orgs order by organization_id
        """, organizationVersion, organizationId, organizationVersion);
    if (organizations.stream().noneMatch(row -> organizationId.equals(text(row, "id")))) {
      throw new GraphSyncException("GRAPH_SYNC_ORGANIZATION_NOT_FOUND",
          "绑定的物业 canonical 版本中不存在目标组织。", false);
    }
    List<String> organizationIds = organizations.stream().map(row -> text(row, "id")).toList();
    for (Map<String, Object> row : organizations) {
      node(nodes, "organization", text(row, "id"), text(row, "label"), organizationId, runId,
          setId, PropertyDataProducts.ORGANIZATION, organizationVersion);
      edgeIfPresent(edges, "contains", "organization", text(row, "parent_id"),
          "organization", text(row, "id"), "canonical-master-data", organizationId, runId,
          setId, PropertyDataProducts.ORGANIZATION, organizationVersion);
    }

    for (Map<String, Object> row : projects(projection, organizationIds)) {
      String productVersion = version(projection, PropertyDataProducts.PROJECT);
      node(nodes, "project", text(row, "id"), text(row, "label"), organizationId, runId,
          setId, PropertyDataProducts.PROJECT, productVersion);
      edgeIfPresent(edges, "contains", "organization", text(row, "organization_id"),
          "project", text(row, "id"), "canonical-master-data", organizationId, runId,
          setId, PropertyDataProducts.PROJECT, productVersion);
    }
    for (Map<String, Object> row : chargeItems(projection, organizationIds)) {
      node(nodes, "charge-item", text(row, "id"), text(row, "label"), organizationId, runId,
          setId, PropertyDataProducts.CHARGE_ITEM,
          version(projection, PropertyDataProducts.CHARGE_ITEM));
    }
    facts(nodes, edges, receivables(projection, organizationIds), "receivable", "has-receivable",
        organizationId, runId, setId, PropertyDataProducts.RECEIVABLE,
        version(projection, PropertyDataProducts.RECEIVABLE));
    facts(nodes, edges, payments(projection, organizationIds), "payment", "has-payment",
        organizationId, runId, setId, PropertyDataProducts.PAYMENT,
        version(projection, PropertyDataProducts.PAYMENT));
    for (Map<String, Object> row : serviceOrders(projection, organizationIds)) {
      String id = text(row, "id");
      String productVersionId = version(projection, PropertyDataProducts.SERVICE_ORDER);
      requireNode(nodes, "project", text(row, "project_id"),
          "服务工单缺少 canonical 项目关系。");
      node(nodes, "service-order", id, id, organizationId, runId, setId,
          PropertyDataProducts.SERVICE_ORDER, productVersionId);
      edgeIfPresent(edges, "has-service-order", "project", text(row, "project_id"),
          "service-order", id, "canonical-derived", organizationId, runId, setId,
          PropertyDataProducts.SERVICE_ORDER, productVersionId);
      if (Boolean.TRUE.equals(row.get("complaint"))) {
        node(nodes, "complaint", id, "投诉:" + id, organizationId, runId, setId,
            PropertyDataProducts.SERVICE_ORDER, productVersionId);
        edge(edges, "has-complaint", "service-order", id, "complaint", id,
            "canonical-derived", organizationId, runId, setId,
            PropertyDataProducts.SERVICE_ORDER, productVersionId);
      }
      if (Boolean.TRUE.equals(row.get("satisfaction"))) {
        node(nodes, "satisfaction", id, "满意度:" + id, organizationId, runId, setId,
            PropertyDataProducts.SERVICE_ORDER, productVersionId);
        edge(edges, "has-satisfaction", "service-order", id, "satisfaction", id,
            "canonical-derived", organizationId, runId, setId,
            PropertyDataProducts.SERVICE_ORDER, productVersionId);
      }
    }
    return new GraphBatch(new ArrayList<>(nodes.values()), new ArrayList<>(edges.values()));
  }

  private List<Map<String, Object>> projects(GraphProjection projection, List<String> organizations) {
    return query("""
        select project_id id,project_name label,organization_id
        from facts.property_project
        where product_version_id=? and organization_id in (%s)
          and not is_deleted and not delete_flag order by project_id
        """, projection, PropertyDataProducts.PROJECT, organizations);
  }

  private List<Map<String, Object>> chargeItems(GraphProjection projection, List<String> organizations) {
    return query("""
        select charge_item_id id,charge_item_name label
        from facts.property_charge_item
        where product_version_id=? and organization_id in (%s)
          and not is_deleted order by charge_item_id
        """, projection, PropertyDataProducts.CHARGE_ITEM, organizations);
  }

  private List<Map<String, Object>> receivables(GraphProjection projection, List<String> organizations) {
    return query("""
        select record_id::text id,coalesce(project_id,'') project_id,
               coalesce(charge_item_id,'') charge_item_id,
               coalesce(charge_item_name,'') charge_item_label
        from facts.property_receivable
        where product_version_id=? and organization_id in (%s)
          and not is_deleted order by record_id
        """, projection, PropertyDataProducts.RECEIVABLE, organizations);
  }

  private List<Map<String, Object>> payments(GraphProjection projection, List<String> organizations) {
    return query("""
        select record_id::text id,coalesce(project_id,'') project_id,
               coalesce(charge_item_id,'') charge_item_id,
               coalesce(charge_item_name,'') charge_item_label
        from facts.property_payment
        where product_version_id=? and organization_id in (%s)
          and not is_deleted order by record_id
        """, projection, PropertyDataProducts.PAYMENT, organizations);
  }

  private List<Map<String, Object>> serviceOrders(GraphProjection projection, List<String> organizations) {
    return query("""
        select service_order_id id,coalesce(project_id,'') project_id,
               coalesce(service_style_name,'') like '%%投诉%%' complaint,
               satisfaction_evaluated satisfaction
        from facts.property_service_order
        where product_version_id=? and organization_id in (%s)
          and not is_deleted order by service_order_id
        """, projection, PropertyDataProducts.SERVICE_ORDER, organizations);
  }

  private List<Map<String, Object>> query(String sql, GraphProjection projection, String productKey,
                                          List<String> organizationIds) {
    if (organizationIds.isEmpty()) return List.of();
    List<Object> arguments = new ArrayList<>();
    arguments.add(version(projection, productKey));
    arguments.addAll(organizationIds);
    return jdbc.queryForList(sql.formatted(placeholders(organizationIds.size())), arguments.toArray());
  }

  private static void facts(Map<String, Map<String, Object>> nodes,
                            Map<String, Map<String, Object>> edges,
                            List<Map<String, Object>> rows, String kind, String projectEdge,
                            String organizationId, String runId, String setId,
                            String productKey, String productVersionId) {
    for (Map<String, Object> row : rows) {
      String id = text(row, "id");
      String projectId = text(row, "project_id");
      String chargeItemId = text(row, "charge_item_id");
      requireNode(nodes, "project", projectId, kind + " 缺少 canonical 项目关系。");
      requireNode(nodes, "charge-item", chargeItemId,
          kind + " 缺少 canonical 收费项目关系。");
      node(nodes, kind, id, id, organizationId, runId, setId, productKey, productVersionId);
      edgeIfPresent(edges, projectEdge, "project", projectId, kind, id,
          "canonical-derived", organizationId, runId, setId, productKey, productVersionId);
      edgeIfPresent(edges, "belongs-to", "charge-item", chargeItemId, kind, id,
          "canonical-derived", organizationId, runId, setId, productKey, productVersionId);
    }
  }

  private static void requireNode(Map<String, Map<String, Object>> nodes, String kind, String id,
                                  String message) {
    if (id.isBlank() || !nodes.containsKey(kind + ":" + id)) {
      throw new GraphSyncException("PROPERTY_GRAPH_REFERENCE_MISSING", message, false);
    }
  }

  private static void node(Map<String, Map<String, Object>> nodes, String kind, String id, String label,
                           String organizationId, String runId, String setId,
                           String productKey, String productVersionId) {
    if (id.isBlank()) return;
    Map<String, Object> node = new LinkedHashMap<>();
    node.put("kind", kind);
    node.put("id", id);
    node.put("label", label.isBlank() ? id : label);
    node.put("organizationId", organizationId);
    node.put("runId", runId);
    node.put("datasetVersionSetId", setId);
    node.put("sourceProductKey", productKey);
    node.put("productVersionId", productVersionId);
    nodes.putIfAbsent(kind + ":" + id, Map.copyOf(node));
  }

  private static void edgeIfPresent(Map<String, Map<String, Object>> edges, String kind,
                                    String fromKind, String fromId, String toKind, String toId,
                                    String source, String organizationId, String runId, String setId,
                                    String productKey, String productVersionId) {
    if (!fromId.isBlank() && !toId.isBlank()) {
      edge(edges, kind, fromKind, fromId, toKind, toId, source, organizationId, runId,
          setId, productKey, productVersionId);
    }
  }

  private static void edge(Map<String, Map<String, Object>> edges, String kind,
                           String fromKind, String fromId, String toKind, String toId,
                           String source, String organizationId, String runId, String setId,
                           String productKey, String productVersionId) {
    Map<String, Object> edge = new LinkedHashMap<>();
    edge.put("kind", kind);
    edge.put("fromKind", fromKind);
    edge.put("fromId", fromId);
    edge.put("toKind", toKind);
    edge.put("toId", toId);
    edge.put("direction", "outbound");
    edge.put("source", source);
    edge.put("explanation", fromKind + " -> " + toKind);
    edge.put("organizationId", organizationId);
    edge.put("runId", runId);
    edge.put("datasetVersionSetId", setId);
    edge.put("sourceProductKey", productKey);
    edge.put("productVersionId", productVersionId);
    edges.put(kind + ":" + fromKind + ":" + fromId + ":" + toKind + ":" + toId,
        Map.copyOf(edge));
  }

  private void assertReadOnly() {
    Boolean transactionReadOnly = jdbc.queryForObject(
        "select current_setting('transaction_read_only')='on'", Boolean.class);
    if (!Boolean.TRUE.equals(transactionReadOnly)) {
      throw new BackendException("PROPERTY_READ_ONLY_TRANSACTION_REQUIRED",
          "物业 canonical 图投影读取未处于 PostgreSQL READ ONLY 事务。");
    }
  }

  private static GraphProjection projection(DatasetVersionSet set) {
    return new GraphProjection(set.publicationId(), set.productVersionIds());
  }

  private static void requirePropertyProjection(GraphProjection projection) {
    if (projection == null || !projection.productVersionIds().keySet().equals(PropertyDataProducts.REQUIRED)) {
      throw new BackendException("PROPERTY_GRAPH_PROJECTION_INCOMPLETE",
          "图投影缺少完整的物业 canonical 产品版本。");
    }
  }

  private static String version(GraphProjection projection, String productKey) {
    String version = projection.productVersionIds().get(productKey);
    if (version == null) {
      throw new BackendException("PROPERTY_GRAPH_PROJECTION_INCOMPLETE",
          "图投影缺少物业产品版本: " + productKey);
    }
    return version;
  }

  private static String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  private static String text(Map<String, Object> row, String key) {
    Object value = row.get(key);
    return value == null ? "" : value.toString().trim();
  }
}
