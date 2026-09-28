package com.dip3.ontologyagent.semantic.api;

import java.time.ZoneId;
import java.util.List;
import java.util.Map;

/**
 * 已校验的语义查询：cubeQuery 只含本体成员与绝对日期，版本、成员资格与授权范围由 Cube 服务端注入。
 *
 * @param range 解析后的查询区间（ALL 时下界为空）
 * @param compareRange 对比区间，可为空
 * @param granularity 时间分桶（小写 Cube 粒度），可为空
 * @param columns 结果列：维度、时间分桶、指标，按展示顺序
 * @param productKeys 查询涉及的数据产品（含成员资格关联对象），用于证据出处
 * @param coverage 时间属性在冻结数据中的覆盖区间探针
 */
public record CompiledSemanticQuery(
    QueryIntent intent,
    String objectKey,
    Map<String, Object> cubeQuery,
    ResolvedTimeRange range,
    ResolvedTimeRange compareRange,
    String timeMember,
    String timeLabel,
    String granularity,
    List<Column> columns,
    List<String> productKeys,
    CoverageProbe coverage,
    ZoneId zone) {

  public enum ColumnKind { DIMENSION, TIME, MEASURE }

  /** member 为 Cube 结果字段名；key 为意图中的路径、指标 key 或 {@code time}。 */
  public record Column(String member, String key, String label, ColumnKind kind, OntologyProperty.Type type) {}

  /** 覆盖区间探针：时间属性所在 Cube 的最早/最晚 epoch 秒指标（由生成器为每个时间属性派生）。 */
  public record CoverageProbe(String fromMember, String toMember) {}
}
