package com.dip3.ontologyagent.semantic.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 冻结 canonical 对象读取；属性与关系仅来自本体声明，版本/范围由服务端传入。 */
public interface ObjectQueryPort {
  Page query(Query query, SemanticQueryPort.AccessContext access);
  Row require(String objectKey, String objectId, SemanticQueryPort.AccessContext access);
  Page related(String objectKey, String objectId, String linkKey, Query query,
               SemanticQueryPort.AccessContext access);

  /** filters/order 使用根对象属性；关系穿透使用 related，不用自由 SQL 或表名。 */
  record Query(String objectKey, List<QueryIntent.Filter> filters, List<QueryIntent.Order> order,
               int limit, int offset) {
    public Query {
      filters = filters == null ? List.of() : List.copyOf(filters);
      order = order == null ? List.of() : List.copyOf(order);
    }
  }

  record Reference(String objectKey, String objectId, String productVersionId) {}
  record Row(Reference reference, Map<String, Object> properties) {
    public Row {
      properties = Collections.unmodifiableMap(new LinkedHashMap<>(properties));
    }
  }
  record Page(String objectKey, List<Row> rows, int limit, int offset, boolean hasMore) {
    public Page { rows = List.copyOf(rows); }
  }
}
