package com.dip3.ontologyagent.semantic.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.semantic.api.OntologyLink.Cardinality;
import com.dip3.ontologyagent.semantic.api.OntologyMetric.Aggregation;
import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Direction;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Filter;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Granularity;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Operator;
import com.dip3.ontologyagent.semantic.api.QueryIntent.TimeSpec;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Kind;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Unit;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SemanticQueryCompilerTest {
  // 2026-09-24 10:00 上海
  private static final Instant ANCHOR = Instant.parse("2026-09-24T02:00:00Z");

  private static final OntologyObjectType CUSTOMER = new OntologyObjectType(
      "demo-customer", "客户", null, "DemoCustomer", "demo-customer-product", "facts.demo_customer", null,
      List.of(OntologyProperty.key("customerId", "客户 ID", "customer_id"),
          OntologyProperty.column("region", "区域", null, Type.STRING, "region"),
          OntologyProperty.column("signedAt", "签约时间", null, Type.TIME, "signed_at")),
      List.of(), List.of(new OntologyMetric("count", "客户数", null, Aggregation.COUNT, null, null)),
      "signedAt", List.of(), Map.of("tenantId", "customerId"));

  private static final OntologyObjectType ORDER = new OntologyObjectType(
      "demo-order", "订单", null, "DemoOrder", "demo-order-product", "facts.demo_order", null,
      List.of(OntologyProperty.key("orderId", "订单 ID", "order_id"),
          OntologyProperty.column("status", "状态", null, Type.STRING, "status"),
          OntologyProperty.column("amount", "金额", null, Type.NUMBER, "amount"),
          OntologyProperty.column("paid", "已支付", null, Type.BOOLEAN, "paid"),
          OntologyProperty.column("customerId", "客户 ID", null, Type.STRING, "customer_id"),
          OntologyProperty.column("createdAt", "下单时间", null, Type.TIME, "created_at")),
      List.of(new OntologyLink("customer", "demo-customer", "customerId", "customerId", Cardinality.MANY_TO_ONE)),
      List.of(new OntologyMetric("count", "订单数", null, Aggregation.COUNT, null, null),
          new OntologyMetric("failedCount", "失败订单数", null, Aggregation.COUNT, null, "{CUBE}.status = 'failed'")),
      "createdAt", List.of("customer"), Map.of("tenantId", "customer.customerId"));

  private static final SemanticQueryCompiler COMPILER = new SemanticQueryCompiler(SemanticModel.of(List.of(
      new OntologyModelContribution() {
        @Override
        public String domainKey() {
          return "demo";
        }

        @Override
        public ZoneId businessZone() {
          return ZoneId.of("Asia/Shanghai");
        }

        @Override
        public List<OntologyObjectType> objects() {
          return List.of(CUSTOMER, ORDER);
        }
      })));

  private static TimeExpression lastDays(int n) {
    return new TimeExpression("最近" + n + "天", Kind.RELATIVE, Unit.DAY, n, null, null, null, null);
  }

  private static TimeExpression all() {
    return new TimeExpression("未指定时间", Kind.ALL, null, null, null, null, null, null);
  }

  @Test
  void compilesTimeGranularityDimensionsFiltersAndOrderIntoCubeQuery() {
    QueryIntent intent = new QueryIntent("demo-order", List.of("count", "failedCount"),
        List.of("status", "customer.region"),
        List.of(new Filter("customer.region", Operator.EQUALS, List.of("华东")),
            new Filter("amount", Operator.GTE, List.of("100"))),
        new TimeSpec(null, lastDays(30), Granularity.WEEK), null,
        List.of(new QueryIntent.Order("count", Direction.DESC), new QueryIntent.Order("time", Direction.ASC)), 10);

    CompiledSemanticQuery query = COMPILER.compile(intent, ANCHOR).require();

    assertEquals(Map.of(
        "measures", List.of("DemoOrder.count", "DemoOrder.failedCount"),
        "dimensions", List.of("DemoOrder.status", "DemoCustomer.region"),
        "filters", List.of(
            Map.of("member", "DemoCustomer.region", "operator", "equals", "values", List.of("华东")),
            Map.of("member", "DemoOrder.amount", "operator", "gte", "values", List.of("100"))),
        "timeDimensions", List.of(Map.of("dimension", "DemoOrder.createdAt",
            "dateRange", List.of("2026-08-26", "2026-09-24"), "granularity", "week")),
        "order", List.of(List.of("DemoOrder.count", "desc"), List.of("DemoOrder.createdAt", "asc")),
        "limit", 10,
        "timezone", "Asia/Shanghai"), query.cubeQuery());
    assertEquals(LocalDate.parse("2026-08-26"), query.range().from());
    assertEquals(List.of("status", "customer.region", "time", "count", "failedCount"),
        query.columns().stream().map(CompiledSemanticQuery.Column::key).toList());
    assertEquals("DemoOrder.createdAt.week", query.columns().get(2).member());
    assertEquals(List.of("demo-order-product", "demo-customer-product"), query.productKeys());
    assertEquals("DemoOrder.createdAtCoverageFrom", query.coverage().fromMember());
  }

  @Test
  void allDataOmitsDateRangeAndUsesPlatformRowCap() {
    CompiledSemanticQuery query = COMPILER.compile(new QueryIntent("demo-order", List.of("count"), null, null,
        new TimeSpec(null, all(), null), null, null, null), ANCHOR).require();

    assertFalse(query.cubeQuery().containsKey("timeDimensions"));
    assertEquals(SemanticQueryCompiler.ROW_CAP, query.cubeQuery().get("limit"));
    assertTrue(query.range().allData());
  }

  @Test
  void linkedTimeDimensionAndCompareRangeCompileToCompareDateRange() {
    TimeExpression thisWeek = new TimeExpression("本周", Kind.CALENDAR, Unit.WEEK, null, 0, null, null, null);
    TimeExpression lastWeek = new TimeExpression("上周", Kind.CALENDAR, Unit.WEEK, null, -1, null, null, null);

    CompiledSemanticQuery query = COMPILER.compile(new QueryIntent("demo-order", List.of("count"), null, null,
        new TimeSpec("customer.signedAt", thisWeek, null), lastWeek, null, null), ANCHOR).require();

    assertEquals(List.of(Map.of("dimension", "DemoCustomer.signedAt", "compareDateRange",
            List.of(List.of("2026-09-21", "2026-09-24"), List.of("2026-09-14", "2026-09-20")))),
        query.cubeQuery().get("timeDimensions"));
    assertEquals("DemoCustomer.signedAtCoverageFrom", query.coverage().fromMember());
  }

  @Test
  void collectsEveryViolationForOneCorrectionRound() {
    TimeExpression ambiguous = new TimeExpression("前一阵子", Kind.AMBIGUOUS, null, null, null, null, null,
        List.of(lastDays(7), lastDays(30)));
    SemanticQueryCompiler.Result result = COMPILER.compile(new QueryIntent("demo-order",
        List.of("count", "revenue"), List.of("createdAt", "customer.unknown"),
        List.of(new Filter("status", Operator.GT, List.of("1")),
            new Filter("amount", Operator.EQUALS, List.of("abc")),
            new Filter("paid", Operator.EQUALS, List.of("yes")),
            new Filter("status", Operator.SET, List.of("x"))),
        new TimeSpec(null, ambiguous, null), null,
        List.of(new QueryIntent.Order("status", Direction.ASC)), 5000), ANCHOR);

    assertFalse(result.accepted());
    assertNull(result.query());
    List<String> violations = result.violations();
    assertTrue(violations.stream().anyMatch(v -> v.contains("revenue")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("time.granularity")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("customer.unknown")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("大小比较")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("必须是数字")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("true/false")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("set/notSet")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("ambiguous")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("limit")), violations.toString());
    assertTrue(violations.stream().anyMatch(v -> v.contains("order 只能引用")), violations.toString());
  }

  @Test
  void rejectsMissingTimeUnknownObjectAndUnboundedCompare() {
    assertTrue(COMPILER.compile(new QueryIntent("demo-order", List.of("count"), null, null, null, null, null, null),
        ANCHOR).violations().getFirst().contains("time.expression"));
    assertTrue(COMPILER.compile(new QueryIntent("nope", List.of("count"), null, null, null, null, null, null),
        ANCHOR).violations().getFirst().contains("objectKey"));
    assertTrue(COMPILER.compile(new QueryIntent("demo-order", List.of("count"), null, null,
            new TimeSpec(null, all(), null), lastDays(7), null, null), ANCHOR)
        .violations().stream().anyMatch(v -> v.contains("compare")));
  }
}
