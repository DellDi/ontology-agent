/**
 * Story 9.7 — Bootstrap 首个可运行 ontology version 的正式 seed package。
 *
 * 目标：
 * - 集中一处定义新环境启动所需的 canonical baseline（entities/metrics/factors/planStepTemplates）。
 * - 这些对象对应当前真实运行时链路已经依赖的语义（`buildAnalysisPlan`、`STEP_TOOL_FALLBACKS`、
 *   `FACTOR_TEMPLATES`、`governance-seed.ts` 的 causality edges），不是凭空编造。
 * - 与 `governance-seed.ts`（metricVariants/timeSemantics/causalityEdges/evidenceTypes）和
 *   `tool-binding.ts`（default tool bindings）组合为一个完整可部署 approved ontology baseline。
 *
 * 边界：
 * - 本文件只定义对象的值，不执行 DB 操作。
 * - 新环境 bootstrap 由 `scripts/ontology-bootstrap.mts` 装配并调用
 *   `createOntologyBootstrapUseCases(...).bootstrapCanonicalDefinitions({ ... })`。
 * - 本 baseline 不等同于"生产永久定义"——后续 `9.4` 的 change request / approval / publish
 *   流程仍是唯一合法的版本演进路径；本 seed 只负责新环境能被稳定拉起来。
 */

import {
  buildCausalityEdgeSeeds,
  buildEvidenceTypeSeeds,
  buildMetricVariantSeeds,
  buildTimeSemanticSeeds,
} from '@/domain/ontology/governance-seed';
import type {
  CreateOntologyEntityDefinitionInput,
  CreateOntologyFactorDefinitionInput,
  CreateOntologyMetricDefinitionInput,
  CreateOntologyPlanStepTemplateInput,
} from '@/application/ontology/ports';

// ---------------------------------------------------------------------------
// Entities — 真实运行时主链引用的业务实体
// ---------------------------------------------------------------------------
//
// 来源：
// - `project` 是 fee-analysis 会话中的默认 subject（见 `AnalysisContext.entity`）。
// - 其余条目来自 `governance-seed.buildCausalityEdgeSeeds` 的 `sourceEntityKey`，
//   即"已作为归因路径合法端点的业务实体"。本 bootstrap 必须让这些 key 在 entity 表里真实存在，
//   否则 causality edges 会指向不存在的实体。

export function buildRuntimeEntitySeeds(
  versionId: string,
  ts: string,
): CreateOntologyEntityDefinitionInput[] {
  const base = {
    ontologyVersionId: versionId,
    status: 'approved' as const,
    createdAt: ts,
    updatedAt: ts,
    parentBusinessKey: null,
  };

  return [
    {
      ...base,
      id: `entity-project-${versionId}`,
      businessKey: 'project',
      displayName: '项目',
      description: '物业分析场景下的主要实体：单个小区/项目。会话 context 的默认 subject。',
      synonyms: ['小区', '项目A', '项目 A'],
      metadata: { isPrimarySubject: true, intentTypes: ['fee-analysis', 'work-order-analysis'] },
    },
    {
      ...base,
      id: `entity-fee-policy-reach-${versionId}`,
      businessKey: 'fee-policy-reach',
      displayName: '收费政策触达',
      description: '收费政策宣导、通知推送、催缴触达覆盖情况。作为收缴率归因路径合法端点。',
      synonyms: [],
      metadata: { intentTypes: ['fee-analysis'], role: 'causality-source' },
    },
    {
      ...base,
      id: `entity-work-order-response-${versionId}`,
      businessKey: 'work-order-response',
      displayName: '工单响应时效',
      description: '报修/维修工单的处理时长，通过业主体验间接影响收缴率。',
      synonyms: [],
      metadata: { intentTypes: ['fee-analysis', 'work-order-analysis'], role: 'causality-source' },
    },
    {
      ...base,
      id: `entity-billing-timeliness-${versionId}`,
      businessKey: 'billing-timeliness',
      displayName: '账单生成及时性',
      description: '账单生成与推送的及时性。作为收缴率的前置检查因素。',
      synonyms: [],
      metadata: { intentTypes: ['fee-analysis'], role: 'causality-source' },
    },
    {
      ...base,
      id: `entity-dispatch-load-${versionId}`,
      businessKey: 'dispatch-load',
      displayName: '派单负荷分布',
      description: '维修派单负荷不均会直接影响工单响应时效。',
      synonyms: [],
      metadata: { intentTypes: ['work-order-analysis'], role: 'causality-source' },
    },
    {
      ...base,
      id: `entity-service-order-efficiency-${versionId}`,
      businessKey: 'service-order-efficiency',
      displayName: '服务工单效率',
      description: '工单处理效率实体，作为 work-order-analysis 的归因目标。',
      synonyms: [],
      metadata: { intentTypes: ['work-order-analysis'], role: 'causality-target' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Metrics — 父指标定义
// ---------------------------------------------------------------------------
//
// 本文件只负责父指标（MetricDefinition）。双口径 variants 由 `governance-seed.buildMetricVariantSeeds`
// 通过 `parentMetricDefinitionId: 'collection-rate'` 挂接，不在此重复。

export function buildRuntimeMetricSeeds(
  versionId: string,
  ts: string,
): CreateOntologyMetricDefinitionInput[] {
  const base = {
    ontologyVersionId: versionId,
    status: 'approved' as const,
    createdAt: ts,
    updatedAt: ts,
  };

  return [
    {
      ...base,
      id: `metric-collection-rate-${versionId}`,
      businessKey: 'collection-rate',
      displayName: '收缴率',
      description: '年实收 / 年应收 × 100。父指标，具体口径由 MetricVariant 决定（项目口径 / 尾欠口径）。',
      applicableSubjectKeys: ['project'],
      defaultAggregation: 'ratio',
      unit: '%',
      metadata: { intentTypes: ['fee-analysis'], hasVariants: true },
    },
  ];
}

// ---------------------------------------------------------------------------
// Factors — 候选因素定义
// ---------------------------------------------------------------------------
//
// 来源：`src/domain/factor-expansion/models.ts` 的 FACTOR_TEMPLATES。
// 治理层把候选因素从"代码内模板"升级为"治理对象"，以便后续 `9.3/9.4` 直接消费 approved factor。
// 其与 entity 的 businessKey 保持一致，便于 grounding 和 causality edges 引用。

export function buildRuntimeFactorSeeds(
  versionId: string,
  ts: string,
): CreateOntologyFactorDefinitionInput[] {
  const base = {
    ontologyVersionId: versionId,
    status: 'approved' as const,
    createdAt: ts,
    updatedAt: ts,
  };

  return [
    {
      ...base,
      id: `factor-fee-policy-reach-${versionId}`,
      businessKey: 'fee-policy-reach',
      displayName: '收费政策触达',
      description: '收费政策宣导、通知触达频次、催缴覆盖是否发生变化。',
      category: 'policy',
      relatedMetricKeys: ['collection-rate'],
      metadata: { intentTypes: ['fee-analysis'], sourceTemplate: 'FACTOR_TEMPLATES.fee-analysis' },
    },
    {
      ...base,
      id: `factor-work-order-response-${versionId}`,
      businessKey: 'work-order-response',
      displayName: '工单响应时效',
      description: '维修、报修处理延迟通过业主满意度间接影响缴费意愿。',
      category: 'service-quality',
      relatedMetricKeys: ['collection-rate'],
      metadata: { intentTypes: ['fee-analysis', 'work-order-analysis'], sourceTemplate: 'FACTOR_TEMPLATES' },
    },
    {
      ...base,
      id: `factor-billing-timeliness-${versionId}`,
      businessKey: 'billing-timeliness',
      displayName: '账单生成及时性',
      description: '账单推送是否延迟、是否按时触达住户。',
      category: 'operational',
      relatedMetricKeys: ['collection-rate'],
      metadata: { intentTypes: ['fee-analysis'], sourceTemplate: 'FACTOR_TEMPLATES.fee-analysis' },
    },
    {
      ...base,
      id: `factor-dispatch-load-${versionId}`,
      businessKey: 'dispatch-load',
      displayName: '派单负荷分布',
      description: '维修派单负荷是否均匀，影响工单处理时效。',
      category: 'operational',
      relatedMetricKeys: [],
      metadata: { intentTypes: ['work-order-analysis'], sourceTemplate: 'FACTOR_TEMPLATES.work-order-analysis' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Plan Step Templates — 分析计划步骤模板
// ---------------------------------------------------------------------------
//
// 来源：`src/domain/analysis-plan/models.ts` 的 buildAnalysisPlan 固化步骤。
// 治理层让运行时主链从"代码内硬编码"转向"从 registry 读取"，为后续 9.3 grounded planner
// 与 10.1 runtime wiring 奠定 baseline。
//
// requiredCapabilities 与 `STEP_TOOL_FALLBACKS`（use-cases.ts）、`STEP_CAPABILITY_HINTS`
// （tool-binding-use-cases.ts）保持一致。

export function buildRuntimePlanStepTemplateSeeds(
  versionId: string,
  ts: string,
): CreateOntologyPlanStepTemplateInput[] {
  const base = {
    ontologyVersionId: versionId,
    status: 'approved' as const,
    createdAt: ts,
    updatedAt: ts,
  };

  return [
    {
      ...base,
      id: `pst-confirm-analysis-scope-${versionId}`,
      businessKey: 'confirm-analysis-scope',
      displayName: '确认分析范围',
      description: '对齐会话中的分析目标、实体范围、时间口径和比较方式，确保后续步骤前提一致。',
      intentTypes: ['fee-analysis', 'work-order-analysis', 'general-analysis'],
      requiredCapabilities: ['capability-status'],
      sortOrder: 1,
      metadata: { isCommon: true },
    },
    {
      ...base,
      id: `pst-inspect-metric-change-${versionId}`,
      businessKey: 'inspect-metric-change',
      displayName: '校验核心指标波动',
      description: '验证目标指标是否真实发生波动，定位集中在哪些实体或时间切片。',
      intentTypes: ['fee-analysis', 'work-order-analysis', 'general-analysis'],
      requiredCapabilities: ['semantic-query'],
      sortOrder: 2,
      metadata: { primaryTool: 'cube.semantic-query' },
    },
    {
      ...base,
      id: `pst-validate-candidate-factors-${versionId}`,
      businessKey: 'validate-candidate-factors',
      displayName: '查证候选因素',
      description: '围绕候选因素方向逐项查证，识别哪些值得进入下一轮验证。',
      intentTypes: ['fee-analysis', 'work-order-analysis'],
      requiredCapabilities: ['graph-query', 'erp-read'],
      sortOrder: 3,
      metadata: { primaryTools: ['neo4j.graph-query', 'erp.read-model'] },
    },
    {
      ...base,
      id: `pst-synthesize-attribution-${versionId}`,
      businessKey: 'synthesize-attribution',
      displayName: '汇总归因判断',
      description: '汇总前序步骤形成的证据，整理出待验证的归因判断，并为证据展示做好准备。',
      intentTypes: ['fee-analysis', 'work-order-analysis', 'general-analysis'],
      requiredCapabilities: ['semantic-query', 'structured-analysis'],
      sortOrder: 4,
      metadata: { primaryTools: ['cube.semantic-query', 'llm.structured-analysis'] },
    },
  ];
}

// ---------------------------------------------------------------------------
// 聚合：完整的首个可运行 ontology package
// ---------------------------------------------------------------------------

export type OntologyRuntimeSeedPackage = {
  entities: CreateOntologyEntityDefinitionInput[];
  metrics: CreateOntologyMetricDefinitionInput[];
  factors: CreateOntologyFactorDefinitionInput[];
  planStepTemplates: CreateOntologyPlanStepTemplateInput[];
  metricVariants: ReturnType<typeof buildMetricVariantSeeds>;
  timeSemantics: ReturnType<typeof buildTimeSemanticSeeds>;
  causalityEdges: ReturnType<typeof buildCausalityEdgeSeeds>;
  evidenceTypes: ReturnType<typeof buildEvidenceTypeSeeds>;
};

/**
 * 组装首个可运行 ontology version 的完整 seed package。
 *
 * 用于：
 * - operator CLI (`scripts/ontology-bootstrap.mts`)
 * - 集成测试中需要真实运行时 baseline 的场景（非测试专用 snippet）
 *
 * 不包含 toolBindings —— 后者由 `bootstrapCanonicalDefinitions` 内部
 * 通过 `buildDefaultToolCapabilityBindingSeeds(...)` 自动装配。
 */
export function buildDefaultRuntimeOntologyPackage(
  versionId: string,
  ts: string,
): OntologyRuntimeSeedPackage {
  return {
    entities: buildRuntimeEntitySeeds(versionId, ts),
    metrics: buildRuntimeMetricSeeds(versionId, ts),
    factors: buildRuntimeFactorSeeds(versionId, ts),
    planStepTemplates: buildRuntimePlanStepTemplateSeeds(versionId, ts),
    metricVariants: buildMetricVariantSeeds(versionId, ts),
    timeSemantics: buildTimeSemanticSeeds(versionId, ts),
    causalityEdges: buildCausalityEdgeSeeds(versionId, ts),
    evidenceTypes: buildEvidenceTypeSeeds(versionId, ts),
  };
}

/**
 * 首个 baseline 的预期对象数量（供 status/completeness 诊断对照）。
 * 该清单是"新环境必须至少具备的数量"，后续 9.4 发布扩展版本时应大于等于这些数字。
 */
export const DEFAULT_RUNTIME_BASELINE_EXPECTED_COUNTS = {
  entities: 6,
  metrics: 1,
  factors: 4,
  planStepTemplates: 4,
  metricVariants: 6,
  timeSemantics: 3,
  causalityEdges: 4,
  evidenceTypes: 4,
  // toolBindings 由 buildDefaultToolCapabilityBindingSeeds 控制，数量会随 binding 库演进。
  // 仅校验 > 0，不锁定具体数字，避免后续扩展触发误报。
  toolBindingsMin: 1,
} as const;
