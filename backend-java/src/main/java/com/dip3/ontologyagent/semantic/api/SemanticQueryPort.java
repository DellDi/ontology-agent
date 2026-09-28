package com.dip3.ontologyagent.semantic.api;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 语义查询执行端口：只接受已编译查询，冻结版本与授权范围由调用方以服务端上下文提供。 */
public interface SemanticQueryPort {

  SemanticQueryResult execute(CompiledSemanticQuery query, AccessContext access);

  /** 查询时间属性在冻结数据（同一授权范围）中的覆盖区间；无数据时两端为空。 */
  DataCoverage coverage(CompiledSemanticQuery query, AccessContext access);

  /**
   * @param productVersions 冻结版本集中的 productKey → productVersionId
   * @param scope 授权范围；values 为空表示全部数据（仅平台管理员等全量授权）
   */
  record AccessContext(Map<String, String> productVersions, Scope scope) {
    public AccessContext {
      productVersions = Map.copyOf(productVersions);
      if (scope == null) throw new IllegalArgumentException("scope must not be null");
    }
  }

  /** 授权范围：all 为全部数据；scoped 按维度（如 userId）限定允许值。 */
  record Scope(boolean all, Map<String, List<String>> values) {
    public Scope {
      Map<String, List<String>> copy = new LinkedHashMap<>();
      if (values != null) values.forEach((key, list) -> copy.put(key, List.copyOf(list)));
      values = java.util.Collections.unmodifiableMap(copy);
      if (all != values.isEmpty()) {
        throw new IllegalArgumentException("all scope must not carry values; scoped scope requires values");
      }
    }

    public static Scope everything() {
      return new Scope(true, Map.of());
    }

    public static Scope restricted(Map<String, List<String>> values) {
      return new Scope(false, values);
    }
  }

  /**
   * @param rows 结果行：列 key（见 {@link CompiledSemanticQuery.Column#key()}）→ 值；指标为数值，时间分桶为 ISO 日期
   * @param compareRows 对比区间结果行，无对比时为空
   * @param sql 语义引擎生成的 SQL（审计用）
   */
  record SemanticQueryResult(List<Map<String, Object>> rows, List<Map<String, Object>> compareRows, String sql) {
    public SemanticQueryResult {
      rows = List.copyOf(rows);
      compareRows = compareRows == null ? List.of() : List.copyOf(compareRows);
    }
  }

  record DataCoverage(LocalDate from, LocalDate to) {
    public boolean empty() {
      return from == null || to == null;
    }
  }
}
