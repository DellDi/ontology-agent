/**
 * 治理化 seed 数据：将当前仓库中已真实运行的业务语义正式收入 ontology registry。
 *
 * 这些定义在运行时是 canonical source（从 platform schema 读取），
 * 而不是从 metric-catalog.ts 或 factor-expansion/models.ts 里的硬编码读取。
 *
 * 本文件只定义"治理对象的值"，不做 DB 操作——
 * 写入 DB 由 application 层 use-cases 的 loadGovernanceDefinitions 完成。
 */

import type { CreateOntologyCausalityEdgeInput } from '@/application/ontology/ports';
import type { CreateOntologyEvidenceTypeDefinitionInput } from '@/application/ontology/ports';
import type { CreateOntologyMetricVariantInput } from '@/application/ontology/ports';
import type { CreateOntologyTimeSemanticInput } from '@/application/ontology/ports';

// ---------------------------------------------------------------------------
// Metric Variants — 收费类双口径
// ---------------------------------------------------------------------------

export function buildMetricVariantSeeds(versionId: string, ts: string): CreateOntologyMetricVariantInput[] {
  const base = { ontologyVersionId: versionId, status: 'approved' as const, createdAt: ts, updatedAt: ts };

  return [
    {
      ...base,
      id: `mv-project-collection-rate-${versionId}`,
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'project-collection-rate',
      displayName: '项目口径收缴率',
      description: '项目口径下，年实收 / 年应收 × 100。应收按应收账期圈定，实收按缴款日期统计。',
      semanticDiscriminator: 'project-scope',
      cubeViewMapping: {
        numeratorMetricKey: 'project-paid-amount',
        denominatorMetricKey: 'project-receivable-amount',
        cubeMeasure: null,
        formula: 'project-paid-amount / project-receivable-amount * 100',
      },
      filterTemplate: null,
      metadata: { sourceFact: '应收主题 + 缴款主题（项目口径）' },
    },
    {
      ...base,
      id: `mv-project-receivable-amount-${versionId}`,
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'project-receivable-amount',
      displayName: '项目口径应收金额',
      description: '项目口径下的应收金额，按应收账期 shouldAccountBook 归属到当年全年账单。',
      semanticDiscriminator: 'project-scope',
      cubeViewMapping: { cubeMeasure: 'FinanceReceivables.receivableAmount' },
      filterTemplate: null,
      metadata: { sourceFact: '应收主题（项目口径）' },
    },
    {
      ...base,
      id: `mv-project-paid-amount-${versionId}`,
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'project-paid-amount',
      displayName: '项目口径实收金额',
      description: '项目口径下的实收金额，按应收账期圈定应收 cohort，再按缴款日期统计 chargePaid。',
      semanticDiscriminator: 'project-scope',
      cubeViewMapping: { cubeMeasure: 'FinancePayments.paidAmount' },
      filterTemplate: null,
      metadata: { sourceFact: '缴款主题（项目口径）' },
    },
    {
      ...base,
      id: `mv-tail-arrears-collection-rate-${versionId}`,
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'tail-arrears-collection-rate',
      displayName: '尾欠口径收缴率',
      description: '尾欠口径下，年实收 / 年应收 × 100。应收按历史尾欠 cohort 圈定，实收按缴款日期统计。',
      semanticDiscriminator: 'tail-arrears-scope',
      cubeViewMapping: {
        numeratorMetricKey: 'tail-arrears-paid-amount',
        denominatorMetricKey: 'tail-arrears-receivable-amount',
        cubeMeasure: null,
        formula: 'tail-arrears-paid-amount / tail-arrears-receivable-amount * 100',
      },
      filterTemplate: null,
      metadata: { sourceFact: '应收主题 + 缴款主题（尾欠口径）' },
    },
    {
      ...base,
      id: `mv-tail-arrears-receivable-amount-${versionId}`,
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'tail-arrears-receivable-amount',
      displayName: '尾欠口径应收金额',
      description: '尾欠口径下的历史尾欠应收金额，按 calcEndDate / calcEndYear 圈定跨年未收账单。',
      semanticDiscriminator: 'tail-arrears-scope',
      cubeViewMapping: { cubeMeasure: 'FinanceReceivables.receivableAmount' },
      filterTemplate: null,
      metadata: { sourceFact: '应收主题（尾欠口径）' },
    },
    {
      ...base,
      id: `mv-tail-arrears-paid-amount-${versionId}`,
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'tail-arrears-paid-amount',
      displayName: '尾欠口径实收金额',
      description: '尾欠口径下的实收金额，按历史尾欠应收 cohort 圈定，再按缴款日期统计 chargePaid。',
      semanticDiscriminator: 'tail-arrears-scope',
      cubeViewMapping: { cubeMeasure: 'FinancePayments.paidAmount' },
      filterTemplate: null,
      metadata: { sourceFact: '缴款主题（尾欠口径）' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Time Semantics — 三类时间语义
// ---------------------------------------------------------------------------

export function buildTimeSemanticSeeds(versionId: string, ts: string): CreateOntologyTimeSemanticInput[] {
  const base = { ontologyVersionId: versionId, status: 'approved' as const, createdAt: ts, updatedAt: ts };

  return [
    {
      ...base,
      id: `ts-receivable-accounting-period-${versionId}`,
      businessKey: 'receivable-accounting-period',
      displayName: '应收账期',
      description: '按 shouldAccountBook 字段圈定全年应收账期。项目口径默认时间维度。',
      semanticType: 'accounting-period',
      entityDateFieldMapping: { receivable: 'shouldAccountBook' },
      cubeTimeDimensionMapping: { cubeDimension: 'FinanceReceivables.receivableAccountingPeriod' },
      calculationRule: null,
      defaultGranularity: 'year',
      metadata: {},
    },
    {
      ...base,
      id: `ts-billing-cycle-end-date-${versionId}`,
      businessKey: 'billing-cycle-end-date',
      displayName: '账单截止日期',
      description: '按 calcEndDate / calcEndYear 圈定跨年尾欠 cohort。尾欠口径默认时间维度。',
      semanticType: 'billing-cutoff',
      entityDateFieldMapping: { receivable: 'calcEndDate', receivableYear: 'calcEndYear' },
      cubeTimeDimensionMapping: { cubeDimension: 'FinanceReceivables.billingCycleEndDate' },
      calculationRule: null,
      defaultGranularity: 'year',
      metadata: {},
    },
    {
      ...base,
      id: `ts-payment-date-${versionId}`,
      businessKey: 'payment-date',
      displayName: '缴款日期',
      description: '按 operatorDate 统计实收。实收类指标必选时间维度。',
      semanticType: 'transaction-date',
      entityDateFieldMapping: { payment: 'operatorDate' },
      cubeTimeDimensionMapping: { cubeDimension: 'FinancePayments.paymentDate' },
      calculationRule: null,
      defaultGranularity: 'month',
      metadata: {},
    },
  ];
}

// ---------------------------------------------------------------------------
// Causality Edges — 因果关系治理边
// ---------------------------------------------------------------------------

export function buildCausalityEdgeSeeds(versionId: string, ts: string): CreateOntologyCausalityEdgeInput[] {
  const base = { ontologyVersionId: versionId, status: 'approved' as const, createdAt: ts, updatedAt: ts };

  return [
    {
      ...base,
      id: `ce-fee-policy-reach-${versionId}`,
      businessKey: 'fee-policy-reach',
      displayName: '收费政策触达 → 收缴率',
      description: '收费政策、触达频次和通知覆盖变化会直接影响收缴率指标。',
      sourceEntityKey: 'fee-policy-reach',
      targetEntityKey: 'collection-rate',
      causalityType: 'direct-influence',
      isAttributionPathEnabled: true,
      defaultWeight: { type: 'fixed', value: 1.0 },
      neo4jRelationshipTypes: ['INFLUENCES'],
      temporalConstraints: null,
      filterConditions: null,
      metadata: { intentTypes: ['fee-analysis'] },
    },
    {
      ...base,
      id: `ce-work-order-response-${versionId}`,
      businessKey: 'work-order-response',
      displayName: '工单响应时效 → 收缴率',
      description: '维修、报修处理延迟会影响业主缴费意愿和回款节奏。',
      sourceEntityKey: 'work-order-response',
      targetEntityKey: 'collection-rate',
      causalityType: 'indirect-influence',
      isAttributionPathEnabled: true,
      defaultWeight: { type: 'fixed', value: 0.8 },
      neo4jRelationshipTypes: ['INFLUENCES'],
      temporalConstraints: null,
      filterConditions: null,
      metadata: { intentTypes: ['fee-analysis'] },
    },
    {
      ...base,
      id: `ce-billing-timeliness-${versionId}`,
      businessKey: 'billing-timeliness',
      displayName: '账单生成及时性 → 收缴率',
      description: '账单生成或推送是否及时，影响用户按时缴费能力。',
      sourceEntityKey: 'billing-timeliness',
      targetEntityKey: 'collection-rate',
      causalityType: 'direct-influence',
      isAttributionPathEnabled: true,
      defaultWeight: { type: 'fixed', value: 0.9 },
      neo4jRelationshipTypes: ['INFLUENCES'],
      temporalConstraints: null,
      filterConditions: null,
      metadata: { intentTypes: ['fee-analysis'] },
    },
    {
      ...base,
      id: `ce-dispatch-load-${versionId}`,
      businessKey: 'dispatch-load',
      displayName: '派单负荷分布 → 工单时效',
      description: '派单负荷不均匀会拉低工单处理时效。',
      sourceEntityKey: 'dispatch-load',
      targetEntityKey: 'service-order-efficiency',
      causalityType: 'direct-influence',
      isAttributionPathEnabled: true,
      defaultWeight: { type: 'fixed', value: 1.0 },
      neo4jRelationshipTypes: ['INFLUENCES'],
      temporalConstraints: null,
      filterConditions: null,
      metadata: { intentTypes: ['work-order-analysis'] },
    },
  ];
}

// ---------------------------------------------------------------------------
// Evidence Types — 证据类型定义
// ---------------------------------------------------------------------------

export function buildEvidenceTypeSeeds(versionId: string, ts: string): CreateOntologyEvidenceTypeDefinitionInput[] {
  const base = { ontologyVersionId: versionId, status: 'approved' as const, createdAt: ts, updatedAt: ts };

  return [
    {
      ...base,
      id: `et-table-evidence-${versionId}`,
      businessKey: 'table-evidence',
      displayName: '表格证据',
      description: '以 Cube 查询结果表格形式呈现的量化证据。',
      evidenceCategory: 'quantitative',
      rendererConfig: { type: 'data-table', sortable: true, pagination: true },
      dataSourceConfig: { adapter: 'cube-semantic-query' },
      defaultPriority: 'high',
      isInteractive: false,
      templateSchema: null,
      validationRules: [{ rule: 'non-empty-rows', message: '表格证据必须包含至少一行数据' }],
      metadata: {},
    },
    {
      ...base,
      id: `et-graph-evidence-${versionId}`,
      businessKey: 'graph-evidence',
      displayName: '图谱证据',
      description: '以 Neo4j 因果路径形式呈现的归因关系证据。',
      evidenceCategory: 'causal',
      rendererConfig: { type: 'graph-path', directed: true },
      dataSourceConfig: { adapter: 'neo4j-graph-query' },
      defaultPriority: 'high',
      isInteractive: false,
      templateSchema: null,
      validationRules: [],
      metadata: {},
    },
    {
      ...base,
      id: `et-erp-fact-evidence-${versionId}`,
      businessKey: 'erp-fact-evidence',
      displayName: 'ERP 事实证据',
      description: '从 ERP staging 层直接提取的业务事实数据，作为辅助验证证据。',
      evidenceCategory: 'factual',
      rendererConfig: { type: 'key-value-list' },
      dataSourceConfig: { adapter: 'erp-staging-query' },
      defaultPriority: 'normal',
      isInteractive: false,
      templateSchema: null,
      validationRules: [],
      metadata: {},
    },
    {
      ...base,
      id: `et-model-summary-evidence-${versionId}`,
      businessKey: 'model-summary-evidence',
      displayName: '模型摘要证据',
      description: 'LLM 生成的分析摘要与推理链路，作为定性证据补充。',
      evidenceCategory: 'qualitative',
      rendererConfig: { type: 'markdown-block' },
      dataSourceConfig: { adapter: 'llm-structured-output' },
      defaultPriority: 'normal',
      isInteractive: true,
      templateSchema: null,
      validationRules: [],
      metadata: {},
    },
  ];
}
