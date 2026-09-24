package com.dip3.ontologyagent.semantic.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.semantic.api.OntologyLink.Cardinality;
import com.dip3.ontologyagent.semantic.api.OntologyMetric.Aggregation;
import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CubeModelGeneratorTest {

  private static OntologyObjectType order() {
    return new OntologyObjectType("demo-order", "订单", "演示订单", "DemoOrder", "demo-order-product",
        "facts.demo_order", "not is_deleted",
        List.of(
            OntologyProperty.key("orderId", "订单 ID", "order_id"),
            OntologyProperty.column("status", "状态", "订单终态", Type.STRING, "status"),
            OntologyProperty.column("createdAt", "创建时间", "下单时间", Type.TIME, "created_at"),
            OntologyProperty.column("customerId", "客户 ID", "客户", Type.STRING, "customer_id")),
        List.of(new OntologyLink("customer", "demo-customer", "customerId", "customerId", Cardinality.MANY_TO_ONE)),
        List.of(
            new OntologyMetric("count", "订单数", "去重订单数", Aggregation.COUNT_DISTINCT, "{CUBE}.order_id", null),
            new OntologyMetric("failedCount", "失败订单数", "失败订单", Aggregation.COUNT_DISTINCT,
                "{CUBE}.order_id", "{CUBE}.status = 'failed'"),
            new OntologyMetric("p95Ms", "P95 耗时", "终态订单耗时 P95", Aggregation.PERCENTILE_95,
                "{CUBE}.duration_ms", "{CUBE}.duration_ms is not null")));
  }

  private static OntologyObjectType customer() {
    return new OntologyObjectType("demo-customer", "客户", "演示客户", "DemoCustomer", "demo-customer-product",
        "facts.demo_customer", null,
        List.of(OntologyProperty.key("customerId", "客户 ID", "customer_id")),
        List.of(),
        List.of(new OntologyMetric("count", "客户数", "客户数", Aggregation.COUNT, null, null)));
  }

  @Test
  void generatesDeterministicCubeYamlWithHiddenVersionDimension() {
    Map<String, String> files = CubeModelGenerator.generate(List.of(order(), customer()));

    String yaml = files.get("DemoOrder.yml");
    assertEquals("""
        # 由本体声明生成（CubeModelGenerator），请勿手工修改。
        cubes:
          - name: "DemoOrder"
            title: "订单"
            description: "演示订单"
            sql: "select * from facts.demo_order where not is_deleted"
            meta:
              ontologyObject: "demo-order"
              productKey: "demo-order-product"
            joins:
              - name: "DemoCustomer"
                relationship: "many_to_one"
                sql: "{CUBE}.customer_id = {DemoCustomer}.customer_id"
            dimensions:
              - name: "productVersionId"
                sql: "{CUBE}.product_version_id"
                type: "string"
                public: false
              - name: "orderId"
                title: "订单 ID"
                sql: "{CUBE}.order_id"
                type: "string"
                primary_key: true
                public: true
              - name: "status"
                title: "状态"
                description: "订单终态"
                sql: "{CUBE}.status"
                type: "string"
              - name: "createdAt"
                title: "创建时间"
                description: "下单时间"
                sql: "{CUBE}.created_at"
                type: "time"
              - name: "customerId"
                title: "客户 ID"
                description: "客户"
                sql: "{CUBE}.customer_id"
                type: "string"
            measures:
              - name: "count"
                title: "订单数"
                description: "去重订单数"
                sql: "{CUBE}.order_id"
                type: "count_distinct"
              - name: "failedCount"
                title: "失败订单数"
                description: "失败订单"
                sql: "{CUBE}.order_id"
                type: "count_distinct"
                filters:
                  - sql: "{CUBE}.status = 'failed'"
              - name: "p95Ms"
                title: "P95 耗时"
                description: "终态订单耗时 P95"
                sql: "ceil(percentile_cont(0.95) within group (order by {CUBE}.duration_ms) filter (where {CUBE}.duration_ms is not null))"
                type: "number"
        """, yaml);
    assertTrue(files.get("DemoCustomer.yml").contains("sql_table: \"facts.demo_customer\""));
    assertTrue(files.get("DemoCustomer.yml").contains("type: \"count\""));
  }

  @Test
  void generatesVersionedCubeIndexForQueryRewrite() {
    Map<String, String> files = CubeModelGenerator.generate(List.of(order(), customer()));

    assertEquals("""
        {
          "DemoCustomer": "demo-customer-product",
          "DemoOrder": "demo-order-product"
        }
        """, files.get(CubeModelGenerator.VERSIONED_INDEX_FILE));
  }

  @Test
  void rejectsDanglingLinkTarget() {
    BackendException error = assertThrows(BackendException.class,
        () -> CubeModelGenerator.generate(List.of(order())));
    assertEquals("SEMANTIC_MODEL_INVALID", error.code());
    assertTrue(error.getMessage().contains("demo-customer"));
  }

  @Test
  void rejectsLinkOnUnknownProperty() {
    OntologyObjectType broken = new OntologyObjectType("demo-order", "订单", "d", "DemoOrder", "p",
        "facts.demo_order", null, List.of(OntologyProperty.key("orderId", "订单 ID", "order_id")),
        List.of(new OntologyLink("customer", "demo-customer", "customerId", "customerId", Cardinality.MANY_TO_ONE)),
        List.of());

    BackendException error = assertThrows(BackendException.class,
        () -> CubeModelGenerator.generate(List.of(broken, customer())));
    assertEquals("SEMANTIC_MODEL_INVALID", error.code());
  }

  @Test
  void rejectsDuplicateCubeNameAndReservedMember() {
    assertThrows(BackendException.class, () -> CubeModelGenerator.generate(List.of(customer(), customer())));
    assertThrows(BackendException.class, () -> new OntologyObjectType("x", "x", "x", "X", "p", "t", null,
        List.of(OntologyProperty.key("productVersionId", "v", "v")), List.of(), List.of()));
  }

  @Test
  void rejectsInvalidIdentifiersAndMissingPrimaryKey() {
    assertThrows(BackendException.class, () -> OntologyProperty.column("bad-name", "x", "x", Type.STRING, "c"));
    assertThrows(BackendException.class, () -> new OntologyObjectType("x", "x", "x", "X", "p", "t", null,
        List.of(OntologyProperty.column("a", "a", "a", Type.STRING, "a")), List.of(), List.of()));
    assertThrows(BackendException.class, () -> new OntologyMetric("m", "m", "m", Aggregation.SUM, null, null));
    assertThrows(BackendException.class, () -> new OntologyObjectType("x", "x", "x", "X", "p", "t",
        "not {CUBE}.is_deleted", List.of(OntologyProperty.key("a", "a", "a")), List.of(), List.of()));
  }
}
