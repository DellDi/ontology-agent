/**
 * seed-ontology-baseline.mts
 *
 * ⚠️ DEPRECATED（Story 9.7, 2026-04-21）
 *
 * 本脚本是 Epic 9.1/9.2 时期的半成品初始化入口：
 * - 仅覆盖 4 类对象（entities / metrics / factors / planStepTemplates）
 * - 使用老的 `loadOntologyDefinitions`，不走 Story 9.3 补齐的事务边界与完整性校验
 * - 不装载 metricVariants / timeSemantics / causalityEdges / evidenceTypes / toolBindings
 *
 * 新环境初始化的正式入口是 Story 9.7 的：
 *   pnpm ontology:bootstrap             # 幂等装载首个 approved version
 *   pnpm ontology:bootstrap:status      # 检查 baseline completeness
 *
 * 本文件保留是因为其中 organization / owner / staff / receivables-focused 等 entity
 * 与 metric 定义仍有扩展价值，作为 Story 9.4 正式 change request / approval 流程
 * 引入新版本时的候选参考。**不再作为生产初始化入口调用**。
 *
 * 历史使用方式（已 deprecated）：
 *   pnpm exec tsx scripts/seed-ontology-baseline.mts
 *
 * 环境要求：DATABASE_URL 必须已设置或存在于 .env 文件。
 */

import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { createPostgresDb } from '@/infrastructure/postgres/client';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { createPostgresOntologyEntityDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-entity-definition-store';
import { createPostgresOntologyMetricDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-metric-definition-store';
import { createPostgresOntologyFactorDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-factor-definition-store';
import { createPostgresOntologyPlanStepTemplateStore } from '@/infrastructure/ontology/postgres-ontology-plan-step-template-store';
import {
  createOntologyVersion,
  loadOntologyDefinitions,
} from '@/application/ontology/use-cases';
import type {
  CreateOntologyEntityDefinitionInput,
  CreateOntologyFactorDefinitionInput,
  CreateOntologyMetricDefinitionInput,
  CreateOntologyPlanStepTemplateInput,
} from '@/application/ontology/ports';

const BASELINE_VERSION_ID = 'ontv-baseline-v1-0-0';
const BASELINE_SEMVER = '1.0.0';
const NOW = new Date().toISOString();

const ENTITY_DEFINITIONS: CreateOntologyEntityDefinitionInput[] = [
  {
    id: `${BASELINE_VERSION_ID}:entity:organization`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'organization',
    displayName: '组织',
    description: '物业管理公司或区域组织单元，是分析的顶层归属主体。',
    status: 'approved',
    synonyms: ['公司', '管理处', '机构'],
    parentBusinessKey: null,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:entity:project`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'project',
    displayName: '项目',
    description: '物业管理项目/楼盘，是收费、工单、投诉和满意度数据的主要归属单元。',
    status: 'approved',
    synonyms: ['楼盘', '小区', '物业项目'],
    parentBusinessKey: 'organization',
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:entity:owner`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'owner',
    displayName: '业主',
    description: '房屋所有人或居住用户，是收费账单的直接关联对象。',
    status: 'approved',
    synonyms: ['用户', '住户', '房东'],
    parentBusinessKey: 'project',
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:entity:charge-item`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'charge-item',
    displayName: '收费项',
    description: '具体的收费项目类型，如物业费、停车费、水电费等。',
    status: 'approved',
    synonyms: ['费项', '费用类型'],
    parentBusinessKey: null,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:entity:service-order`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'service-order',
    displayName: '工单',
    description: '物业服务请求或投诉工单，记录从受理到关闭的全流程信息。',
    status: 'approved',
    synonyms: ['服务工单', '报修单', '投诉单'],
    parentBusinessKey: 'project',
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const METRIC_DEFINITIONS: CreateOntologyMetricDefinitionInput[] = [
  {
    id: `${BASELINE_VERSION_ID}:metric:project-collection-rate`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'project-collection-rate',
    displayName: '项目口径收缴率',
    description:
      '项目口径下，年实收 / 年应收 × 100。应收按应收账期圈定，实收按缴款日期统计。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'ratio',
    unit: '%',
    metadata: { variant: 'project', cubeSource: 'FinanceReceivables+FinancePayments' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:project-receivable-amount`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'project-receivable-amount',
    displayName: '项目口径应收金额',
    description: '项目口径下的应收金额，按应收账期 shouldAccountBook 归属到当年全年账单。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'sum',
    unit: '元',
    metadata: { variant: 'project', cubeSource: 'FinanceReceivables' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:project-paid-amount`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'project-paid-amount',
    displayName: '项目口径实收金额',
    description:
      '项目口径下的实收金额，按应收账期圈定应收 cohort，再按缴款日期统计 chargePaid。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'sum',
    unit: '元',
    metadata: { variant: 'project', cubeSource: 'FinancePayments' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:tail-arrears-collection-rate`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'tail-arrears-collection-rate',
    displayName: '尾欠口径收缴率',
    description:
      '尾欠口径下，年实收 / 年应收 × 100。应收按历史尾欠 cohort 圈定，实收按缴款日期统计。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'ratio',
    unit: '%',
    metadata: { variant: 'tail-arrears', cubeSource: 'FinanceReceivables+FinancePayments' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:tail-arrears-receivable-amount`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'tail-arrears-receivable-amount',
    displayName: '尾欠口径应收金额',
    description:
      '尾欠口径下的历史尾欠应收金额，按 calcEndDate / calcEndYear 圈定跨年未收账单。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'sum',
    unit: '元',
    metadata: { variant: 'tail-arrears', cubeSource: 'FinanceReceivables' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:service-order-count`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'service-order-count',
    displayName: '工单总量',
    description: '按受治理口径统计的工单数量。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'count',
    unit: '单',
    metadata: { cubeSource: 'ServiceOrders' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:complaint-count`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'complaint-count',
    displayName: '投诉量',
    description: '从工单主题中按"投诉"语义切分的投诉数量。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'count',
    unit: '件',
    metadata: { cubeSource: 'ServiceOrders', filter: 'service_style_name=投诉' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:average-satisfaction`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'average-satisfaction',
    displayName: '平均满意度',
    description:
      '按工单满意度字段 satisfaction 聚合出的平均满意度。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'avg',
    unit: '分',
    metadata: { cubeSource: 'ServiceOrders' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:metric:average-close-duration-hours`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'average-close-duration-hours',
    displayName: '平均关闭时长',
    description: '工单从创建到完成的平均关闭时长（小时）。',
    status: 'approved',
    applicableSubjectKeys: ['project', 'organization'],
    defaultAggregation: 'avg',
    unit: '小时',
    metadata: { cubeSource: 'ServiceOrders' },
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const FACTOR_DEFINITIONS: CreateOntologyFactorDefinitionInput[] = [
  {
    id: `${BASELINE_VERSION_ID}:factor:fee-policy-reach`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'fee-policy-reach',
    displayName: '收费政策触达',
    description: '收费政策、触达频次和通知覆盖情况，是收缴率波动的常见前置因素。',
    status: 'approved',
    category: '收费结构',
    relatedMetricKeys: ['project-collection-rate', 'tail-arrears-collection-rate'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:work-order-response`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'work-order-response',
    displayName: '工单响应时效',
    description: '维修、报修处理延迟会影响业主缴费意愿和回款节奏。',
    status: 'approved',
    category: '服务质量',
    relatedMetricKeys: ['project-collection-rate', 'average-satisfaction'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:billing-timeliness`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'billing-timeliness',
    displayName: '账单生成及时性',
    description: '账单生成或推送是否及时，影响用户是否能按时完成缴费。',
    status: 'approved',
    category: '收费结构',
    relatedMetricKeys: ['project-collection-rate'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:dispatch-load`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'dispatch-load',
    displayName: '派单负荷分布',
    description: '派单负荷分布不均容易拉低工单处理效率和满意度。',
    status: 'approved',
    category: '项目运营',
    relatedMetricKeys: ['service-order-count', 'average-close-duration-hours'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:service-response`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'service-response',
    displayName: '服务响应及时性',
    description: '服务响应及时性与投诉量和满意度高度相关，响应时间拉长通常先体现在投诉增多。',
    status: 'approved',
    category: '服务质量',
    relatedMetricKeys: ['complaint-count', 'average-satisfaction'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:repeat-issue`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'repeat-issue',
    displayName: '重复问题复发',
    description: '重复问题反复出现会影响投诉量的异常波动。',
    status: 'approved',
    category: '服务质量',
    relatedMetricKeys: ['complaint-count'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:service-fulfillment`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'service-fulfillment',
    displayName: '服务兑现程度',
    description: '服务兑现程度变化通常会先反映在满意度上，包括承诺兑现、回访完成和问题闭环。',
    status: 'approved',
    category: '服务质量',
    relatedMetricKeys: ['average-satisfaction'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:factor:staffing-change`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'staffing-change',
    displayName: '人力配置变化',
    description: '人力配置或班次变化常会造成多类指标波动，是综合分析的通用候选因素。',
    status: 'approved',
    category: '项目运营',
    relatedMetricKeys: ['service-order-count', 'average-close-duration-hours', 'complaint-count'],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const PLAN_STEP_TEMPLATES: CreateOntologyPlanStepTemplateInput[] = [
  {
    id: `${BASELINE_VERSION_ID}:plan-step:confirm-query-scope`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'confirm-query-scope',
    displayName: '确认查询口径',
    description: '确认目标指标的统计口径，并补齐实体、时间范围等必要信息。适用于极简查询类计划。',
    status: 'approved',
    intentTypes: ['fee-analysis', 'work-order-analysis', 'complaint-analysis', 'satisfaction-analysis', 'general-analysis'],
    requiredCapabilities: ['semantic-query'],
    sortOrder: 1,
    metadata: { planMode: 'minimal' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:plan-step:return-metric-result`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'return-metric-result',
    displayName: '返回指标结果',
    description: '基于确认后的范围返回指标结果，必要时提供基础对比或趋势说明。',
    status: 'approved',
    intentTypes: ['fee-analysis', 'work-order-analysis', 'complaint-analysis', 'satisfaction-analysis', 'general-analysis'],
    requiredCapabilities: ['semantic-query'],
    sortOrder: 2,
    metadata: { planMode: 'minimal' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:plan-step:confirm-analysis-scope`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'confirm-analysis-scope',
    displayName: '确认分析口径',
    description: '确认目标指标、分析对象和时间范围的分析边界，确保后续步骤基于同一口径推进。',
    status: 'approved',
    intentTypes: ['fee-analysis', 'work-order-analysis', 'complaint-analysis', 'satisfaction-analysis', 'general-analysis'],
    requiredCapabilities: ['semantic-query', 'graph-query'],
    sortOrder: 1,
    metadata: { planMode: 'multi-step' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:plan-step:inspect-metric-change`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'inspect-metric-change',
    displayName: '校验核心指标波动',
    description: '验证目标指标是否真实发生波动，并定位波动主要集中在哪些实体或时间切片。',
    status: 'approved',
    intentTypes: ['fee-analysis', 'work-order-analysis', 'complaint-analysis', 'satisfaction-analysis', 'general-analysis'],
    requiredCapabilities: ['semantic-query'],
    sortOrder: 2,
    metadata: { planMode: 'multi-step' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:plan-step:validate-candidate-factors`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'validate-candidate-factors',
    displayName: '逐项验证候选因素',
    description: '围绕候选方向逐项查证，识别哪些因素值得进入下一轮验证。',
    status: 'approved',
    intentTypes: ['fee-analysis', 'work-order-analysis', 'complaint-analysis', 'satisfaction-analysis', 'general-analysis'],
    requiredCapabilities: ['semantic-query', 'graph-query'],
    sortOrder: 3,
    metadata: { planMode: 'multi-step' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${BASELINE_VERSION_ID}:plan-step:synthesize-attribution`,
    ontologyVersionId: BASELINE_VERSION_ID,
    businessKey: 'synthesize-attribution',
    displayName: '汇总归因判断',
    description: '汇总前序步骤形成的证据，整理出待验证的归因判断，并为后续执行与证据展示做好准备。',
    status: 'approved',
    intentTypes: ['fee-analysis', 'work-order-analysis', 'complaint-analysis', 'satisfaction-analysis', 'general-analysis'],
    requiredCapabilities: ['semantic-query', 'graph-query'],
    sortOrder: 4,
    metadata: { planMode: 'multi-step' },
    createdAt: NOW,
    updatedAt: NOW,
  },
];

async function main() {
  const { db, pool } = createPostgresDb();
  const versionStore = createPostgresOntologyVersionStore(db);
  const entityStore = createPostgresOntologyEntityDefinitionStore(db);
  const metricStore = createPostgresOntologyMetricDefinitionStore(db);
  const factorStore = createPostgresOntologyFactorDefinitionStore(db);
  const planStepStore = createPostgresOntologyPlanStepTemplateStore(db);

  try {
    const existing = await versionStore.findById(BASELINE_VERSION_ID);

    if (existing) {
      console.log(`[seed-ontology-baseline] Version ${BASELINE_VERSION_ID} already exists (status=${existing.status}). Skipping.`);
      return;
    }

    console.log('[seed-ontology-baseline] Creating baseline ontology version...');

    await createOntologyVersion({ versionStore }, {
      id: BASELINE_VERSION_ID,
      semver: BASELINE_SEMVER,
      displayName: '基础版本 v1.0.0（从现有仓库定义装载）',
      description:
        '从现有 metric-catalog、factor-expansion、analysis-plan 等模块抽取的初始装载版本。'
        + '这不是治理审批发布版本，仅作为 canonical ontology center 的起点。',
      createdBy: 'system:seed-ontology-baseline',
      createdAt: NOW,
      updatedAt: NOW,
    });

    console.log('[seed-ontology-baseline] Loading definitions...');

    const result = await loadOntologyDefinitions(
      { entityStore, metricStore, factorStore, planStepStore },
      {
        ontologyVersionId: BASELINE_VERSION_ID,
        entities: ENTITY_DEFINITIONS,
        metrics: METRIC_DEFINITIONS,
        factors: FACTOR_DEFINITIONS,
        planStepTemplates: PLAN_STEP_TEMPLATES,
      },
    );

    console.log('[seed-ontology-baseline] Publishing baseline version...');

    await versionStore.updateStatus(
      BASELINE_VERSION_ID,
      'approved',
      new Date().toISOString(),
      { publishedAt: new Date().toISOString() },
    );

    console.log(`[seed-ontology-baseline] Done.`);
    console.log(`  version: ${BASELINE_VERSION_ID} (approved)`);
    console.log(`  entities: ${result.entities.length}`);
    console.log(`  metrics: ${result.metrics.length}`);
    console.log(`  factors: ${result.factors.length}`);
    console.log(`  planStepTemplates: ${result.planStepTemplates.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[seed-ontology-baseline] Fatal error:', error);
  process.exit(1);
});
