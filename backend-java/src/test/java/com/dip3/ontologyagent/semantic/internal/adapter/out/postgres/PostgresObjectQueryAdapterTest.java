package com.dip3.ontologyagent.semantic.internal.adapter.out.postgres;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.time.ZoneId;
import java.util.*;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class PostgresObjectQueryAdapterTest {
  @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17.8-alpine");
  private static PostgresObjectQueryAdapter adapter;
  private static JdbcTemplate jdbc;
  private static final SemanticQueryPort.AccessContext ACCESS = new SemanticQueryPort.AccessContext(
      Map.of("orders", "current", "customers", "customers-current"), SemanticQueryPort.Scope.restricted(Map.of("tenantId", List.of("t1"))));

  @BeforeAll
  static void setup() {
    jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    jdbc.execute("CREATE SCHEMA facts");
    jdbc.execute("CREATE TABLE facts.orders (product_version_id text, id text, customer_id text, tenant_id text, status text, amount numeric)");
    jdbc.execute("CREATE TABLE facts.customers (product_version_id text, id text, tenant_id text, region text)");
    jdbc.execute("INSERT INTO facts.customers VALUES ('customers-current','c1','t1','east'),('customers-current','c2','t2','west'),('customers-current','c3','t1',NULL),('old','c1','t1','west')");
    jdbc.execute("INSERT INTO facts.orders VALUES ('current','o1','c1','t1','paid',10),('current','o2','c1','t1','failed',NULL),"
        + "('current','o3','missing','t1','paid',20),('current','o4','c2','t2','paid',30),('old','o5','c1','t1','paid',999)");
    var customer = new OntologyObjectType("customer", "客户", null, "Customer", "customers", "facts.customers", null,
        List.of(OntologyProperty.key("id", "客户", "id"), OntologyProperty.column("tenantId", "租户", null, OntologyProperty.Type.STRING, "tenant_id"),
            OntologyProperty.column("region", "地区", null, OntologyProperty.Type.STRING, "region")), List.of(new OntologyLink("orders", "order", "id", "customerId", OntologyLink.Cardinality.ONE_TO_MANY)), List.of(), null, List.of(), Map.of("tenantId", "tenantId"));
    var order = new OntologyObjectType("order", "订单", null, "Order", "orders", "facts.orders", null,
        List.of(OntologyProperty.key("id", "订单", "id"), OntologyProperty.column("tenantId", "租户", null, OntologyProperty.Type.STRING, "tenant_id"),
            OntologyProperty.column("customerId", "客户", null, OntologyProperty.Type.STRING, "customer_id"),
            OntologyProperty.column("status", "状态", null, OntologyProperty.Type.STRING, "status"),
            OntologyProperty.column("amount", "金额", null, OntologyProperty.Type.NUMBER, "amount")),
        List.of(new OntologyLink("customer", "customer", "customerId", "id", OntologyLink.Cardinality.MANY_TO_ONE)),
        List.of(new OntologyMetric("count", "订单数", null, OntologyMetric.Aggregation.COUNT, null, null),
            new OntologyMetric("paidCount", "已支付订单数", null, OntologyMetric.Aggregation.COUNT, null, "{CUBE}.status='paid'"),
            new OntologyMetric("amountTotal", "金额合计", null, OntologyMetric.Aggregation.SUM, "{CUBE}.amount", null),
            OntologyMetric.ratio("paidRate", "支付率", null, "paidCount", "count")), null, List.of(), Map.of("tenantId", "tenantId"));
    adapter = new PostgresObjectQueryAdapter(jdbc, SemanticModel.of(List.of(new OntologyModelContribution() {
      public String domainKey() { return "demo"; }
      public ZoneId businessZone() { return ZoneId.of("Asia/Shanghai"); }
      public List<OntologyObjectType> objects() { return List.of(order, customer); }
    })));
  }

  @Test
  void derivedContributorsKeepMetricFilterNullSemanticsFrozenVersionAndScope() {
    assertEquals(List.of("o1", "o3"), ids(new ObjectQueryPort.Query("order", List.of(), List.of(), 20, 0, "paidCount")));
    assertEquals(List.of("o1", "o3"), ids(new ObjectQueryPort.Query("order", List.of(), List.of(), 20, 0, "amountTotal")));
    assertEquals(List.of("o1", "o2", "o3"), ids(new ObjectQueryPort.Query("order", List.of(), List.of(), 20, 0, "paidRate")),
        "比率的依据是分子/分母参与记录的并集，不把百分比当记录数量");
    var extra = new QueryIntent.Filter("id", QueryIntent.Operator.EQUALS, List.of("o3"));
    assertEquals(List.of("o3"), ids(new ObjectQueryPort.Query("order", List.of(extra), List.of(), 20, 0, "amountTotal")));
    assertThrows(BackendException.class, () -> ids(new ObjectQueryPort.Query("order", List.of(), List.of(), 20, 0, "amountTotal; DROP TABLE orders")));
  }

  @Test
  void relatedGroupsUseTheRightTargetVersionAndCannotReadAnotherTenant() {
    var east = new QueryIntent.Filter("customer.region", QueryIntent.Operator.EQUALS, List.of("east"));
    assertEquals(List.of("o1", "o2"), ids(new ObjectQueryPort.Query("order", List.of(east), List.of(), 20, 0)));
    var west = new QueryIntent.Filter("customer.region", QueryIntent.Operator.EQUALS, List.of("west"));
    assertEquals(List.of(), ids(new ObjectQueryPort.Query("order", List.of(west), List.of(), 20, 0)), "其他租户和旧版本的地区不参与读取");
    var unset = new QueryIntent.Filter("customer.region", QueryIntent.Operator.NOT_SET, List.of());
    assertEquals(List.of("o3"), ids(new ObjectQueryPort.Query("order", List.of(unset), List.of(), 20, 0)), "左关联缺失仍属于空分组");
    var injection = new QueryIntent.Filter("customer.region", QueryIntent.Operator.EQUALS, List.of("east' OR TRUE --"));
    assertEquals(List.of(), ids(new ObjectQueryPort.Query("order", List.of(injection), List.of(), 20, 0)));
    var first = adapter.query(new ObjectQueryPort.Query("order", List.of(east), List.of(), 1, 0), ACCESS);
    assertTrue(first.hasMore());
    assertEquals("o2", adapter.query(new ObjectQueryPort.Query("order", List.of(east), List.of(), 1, 1), ACCESS).rows().getFirst().reference().objectId());
  }

  @Test
  void collectionFiltersMustMatchOneChildAndNullGroupsIncludeMixedAndMissingChildren() {
    jdbc.execute("INSERT INTO facts.orders VALUES ('current','o6','c1','t1',NULL,8)");
    try {
      var failed = new QueryIntent.Filter("orders.status", QueryIntent.Operator.EQUALS, List.of("failed"));
      var amount = new QueryIntent.Filter("orders.amount", QueryIntent.Operator.GT, List.of("5"));
      assertEquals(List.of(), ids(new ObjectQueryPort.Query("customer", List.of(failed, amount), List.of(), 20, 0)),
          "有失败订单和另一个有金额的订单，不能冒充同一订单同时满足条件");
      var unset = new QueryIntent.Filter("orders.status", QueryIntent.Operator.NOT_SET, List.of());
      assertEquals(List.of("c1", "c3"), ids(new ObjectQueryPort.Query("customer", List.of(unset), List.of(), 20, 0)),
          "既有空状态记录的客户和没有关联订单的客户都属于空分组");
    } finally { jdbc.execute("DELETE FROM facts.orders WHERE id='o6'"); }
  }

  private List<String> ids(ObjectQueryPort.Query query) {
    return adapter.query(query, ACCESS).rows().stream().map(row -> row.reference().objectId()).toList();
  }
}
