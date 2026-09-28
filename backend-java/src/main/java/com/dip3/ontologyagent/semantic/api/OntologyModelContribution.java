package com.dip3.ontologyagent.semantic.api;

import java.time.ZoneId;
import java.util.List;

/**
 * 领域包向平台语义层贡献的本体对象声明。实现通过
 * {@code META-INF/services/com.dip3.ontologyagent.semantic.api.OntologyModelContribution} 注册，
 * 由 {@link SemanticModel#discover()} 汇总；新增领域或数据表只新增声明，不修改平台代码。
 */
public interface OntologyModelContribution {
  /** 领域 key；Cube 模型生成到 {@code model/<domainKey>/}。 */
  String domainKey();

  /** 业务时区：时间表达式解析与按日/周/月粒度的分桶依据。 */
  ZoneId businessZone();

  List<OntologyObjectType> objects();
}
