import type {
  MetricQueryRequest,
  SemanticGranularity,
  SemanticMetricKey,
} from '@/application/semantic-query/models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import { recognizeIntentFromQuestion } from '@/domain/analysis-intent/models';
import type { AuthSession } from '@/domain/auth/models';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';
import {
  resolveProjectEntityConstraints,
  type ProjectEntityCatalogItem,
} from '@/domain/project-entity-resolution/models';
import type { AnalysisToolName } from '@/domain/tooling/models';

export function resolveSemanticMetricKey(
  metricValue: string,
  questionText: string,
  groundedContext?: OntologyGroundedContext,
): SemanticMetricKey {
  const usesTailArrearsSemantics =
    /尾欠|历史欠费|跨年未收|历史遗留/.test(metricValue) ||
    /尾欠|历史欠费|跨年未收|历史遗留/.test(questionText);
  const groundedMetricKey =
    groundedContext?.metrics.find(
      (metric) => metric.status === 'success' && (metric.variant || metric.canonicalDefinition),
    )?.variant?.businessKey ??
    groundedContext?.metrics.find(
      (metric) => metric.status === 'success' && metric.canonicalDefinition,
    )?.canonicalDefinition?.businessKey;

  if (groundedMetricKey) {
    if (groundedMetricKey === 'collection-rate') {
      return usesTailArrearsSemantics
        ? 'tail-arrears-collection-rate'
        : 'project-collection-rate';
    }

    return groundedMetricKey as SemanticMetricKey;
  }

  if (/应收/.test(metricValue)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-receivable-amount'
      : 'project-receivable-amount';
  }

  if (/实收|回款金额/.test(metricValue)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-paid-amount'
      : 'project-paid-amount';
  }

  if (/投诉/.test(metricValue)) {
    return 'complaint-count';
  }

  if (/满意度|评分/.test(metricValue)) {
    return 'average-satisfaction';
  }

  if (/响应/.test(metricValue)) {
    return 'average-response-duration-hours';
  }

  if (/关闭时长|完工时长/.test(metricValue)) {
    return 'average-close-duration-hours';
  }

  if (/工单|报修|维修/.test(metricValue)) {
    return 'service-order-count';
  }

  if (/应收/.test(questionText)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-receivable-amount'
      : 'project-receivable-amount';
  }

  if (/实收|回款金额/.test(questionText)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-paid-amount'
      : 'project-paid-amount';
  }

  if (/工单|报修|维修/.test(questionText)) {
    return 'service-order-count';
  }

  if (/投诉/.test(questionText)) {
    return 'complaint-count';
  }

  if (/满意度|评分/.test(questionText)) {
    return 'average-satisfaction';
  }

  if (/响应/.test(questionText)) {
    return 'average-response-duration-hours';
  }

  if (/关闭时长|完工时长/.test(questionText)) {
    return 'average-close-duration-hours';
  }

  return usesTailArrearsSemantics
    ? 'tail-arrears-collection-rate'
    : 'project-collection-rate';
}

export function resolveDateDimension(metric: SemanticMetricKey) {
  switch (metric) {
    case 'project-collection-rate':
    case 'project-receivable-amount':
      return 'receivable-accounting-period' as const;
    case 'project-paid-amount':
    case 'tail-arrears-paid-amount':
      return 'payment-date' as const;
    case 'tail-arrears-collection-rate':
    case 'tail-arrears-receivable-amount':
      return 'billing-cycle-end-date' as const;
    case 'average-satisfaction':
    case 'average-close-duration-hours':
      return 'completed-at' as const;
    default:
      return 'created-at' as const;
  }
}

const SUPPORTING_METRIC_KEYWORDS: Array<{
  pattern: RegExp;
  metric: SemanticMetricKey;
}> = [
  { pattern: /收缴率|收费率|回款率/, metric: 'project-collection-rate' },
  { pattern: /应收/, metric: 'project-receivable-amount' },
  { pattern: /实收|回款金额/, metric: 'project-paid-amount' },
  { pattern: /工单|报修|维修|服务压力/, metric: 'service-order-count' },
  { pattern: /投诉/, metric: 'complaint-count' },
  { pattern: /满意度|评分/, metric: 'average-satisfaction' },
  { pattern: /响应/, metric: 'average-response-duration-hours' },
  { pattern: /关闭时长|完工时长|闭环时长/, metric: 'average-close-duration-hours' },
];

const WORK_ORDER_EVIDENCE_METRICS: SemanticMetricKey[] = [
  'complaint-count',
  'average-satisfaction',
  'average-response-duration-hours',
  'average-close-duration-hours',
];

function shouldAttachFactorEvidence(stepId: string) {
  return stepId === 'validate-candidate-factors' || stepId === 'synthesize-attribution';
}

function resolveSupportingMetricKeys(input: {
  primaryMetric: SemanticMetricKey;
  questionText: string;
  stepId: string;
}): SemanticMetricKey[] {
  if (!shouldAttachFactorEvidence(input.stepId)) {
    return [];
  }

  const metrics = new Set<SemanticMetricKey>();
  const questionText = input.questionText;

  for (const rule of SUPPORTING_METRIC_KEYWORDS) {
    if (rule.pattern.test(questionText)) {
      metrics.add(rule.metric);
    }
  }

  const asksForCauseOrPressure = /原因|归因|影响|压力|异常|波动|趋势|如何|怎么样/.test(questionText);
  if (
    asksForCauseOrPressure &&
    (input.primaryMetric === 'service-order-count' || /工单|服务压力/.test(questionText))
  ) {
    for (const metric of WORK_ORDER_EVIDENCE_METRICS) {
      metrics.add(metric);
    }
  }

  metrics.delete(input.primaryMetric);
  return [...metrics];
}

function resolveGranularity(value: string | undefined): SemanticGranularity | undefined {
  if (
    value === 'day' ||
    value === 'week' ||
    value === 'month' ||
    value === 'quarter' ||
    value === 'year'
  ) {
    return value;
  }

  return undefined;
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveDateRange(
  metric: SemanticMetricKey,
  context: AnalysisContext,
  now: Date = new Date(),
  groundedContext?: OntologyGroundedContext,
) {
  const value = context.timeRange.value;
  const current = new Date(now);
  const groundedDimension =
    groundedContext?.timeSemantics.find(
      (item) => item.status === 'success' && item.canonicalDefinition,
    )?.canonicalDefinition?.businessKey;
  const resolvedDimension = groundedDimension
    ? (groundedDimension as ReturnType<typeof resolveDateDimension>)
    : resolveDateDimension(metric);
  const explicitYearMatch = value.match(/^((?:19|20)\d{2})年?$/u);

  if (explicitYearMatch?.[1]) {
    const year = Number(explicitYearMatch[1]);
    const from = new Date(year, 0, 1);
    const to = new Date(year, 11, 31);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(to),
    };
  }

  if (/本月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth(), 1);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/上月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const to = new Date(current.getFullYear(), current.getMonth(), 0);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(to),
    };
  }

  if (/近三个月|最近三个月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth() - 2, 1);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/本季度/.test(value)) {
    const quarterMonth = Math.floor(current.getMonth() / 3) * 3;
    const from = new Date(current.getFullYear(), quarterMonth, 1);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/今年|本年/.test(value)) {
    const from = new Date(current.getFullYear(), 0, 1);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/去年/.test(value)) {
    const from = new Date(current.getFullYear() - 1, 0, 1);
    const to = new Date(current.getFullYear() - 1, 11, 31);
    return {
      dimension: resolvedDimension,
      from: formatDate(from),
      to: formatDate(to),
    };
  }

  return undefined;
}

export function resolveErpResource(questionText: string) {
  if (/收费|回款|缴费|欠费/.test(questionText)) {
    return 'receivables' as const;
  }

  if (/工单|投诉|满意度|报修|维修/.test(questionText)) {
    return 'service-orders' as const;
  }

  return 'projects' as const;
}

function extractProjectConstraintValues(context: AnalysisContext) {
  return context.constraints
    .filter((constraint) => constraint.label === '项目约束')
    .map((constraint) => constraint.value.trim())
    .filter((value) => value.length > 0 && value !== '项目');
}

function resolveProjectNameFilters(context: AnalysisContext) {
  const projectNames = extractProjectConstraintValues(context);

  if (projectNames.length === 0) {
    return undefined;
  }

  return [
    {
      dimension: 'project-name' as const,
      values: [...new Set(projectNames)],
    },
  ];
}

function resolveProjectScope(input: {
  context: AnalysisContext;
  currentProjectIds: string[];
  projectCatalog?: ProjectEntityCatalogItem[];
}) {
  const projectConstraintValues = extractProjectConstraintValues(input.context);

  if (projectConstraintValues.length === 0 || !input.projectCatalog) {
    return {
      projectIds: input.currentProjectIds,
      filters: resolveProjectNameFilters(input.context),
    };
  }

  const resolution = resolveProjectEntityConstraints({
    values: projectConstraintValues,
    catalog: input.projectCatalog,
  });
  const allowedProjectIds = new Set(input.currentProjectIds);
  const scopedProjectIds =
    input.currentProjectIds.length > 0
      ? resolution.projectIds.filter((projectId) => allowedProjectIds.has(projectId))
      : resolution.projectIds;

  if (scopedProjectIds.length > 0) {
    return {
      projectIds: scopedProjectIds,
      filters: undefined,
    };
  }

  return {
    projectIds: input.currentProjectIds,
    filters: undefined,
  };
}

export function buildWorkerAuthSession(input: {
  sessionId: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
}): AuthSession {
  return {
    userId: input.ownerUserId,
    displayName: 'analysis-execution-worker',
    scope: {
      organizationId: input.organizationId,
      projectIds: input.projectIds,
      areaIds: input.areaIds,
      roleCodes: ['PROPERTY_ANALYST'],
    },
    sessionId: input.sessionId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export function buildToolInputs(input: {
  sessionId: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  questionText: string;
  context: AnalysisContext;
  projectCatalog?: ProjectEntityCatalogItem[];
  groundedContext?: OntologyGroundedContext;
  step: {
    id: string;
    title: string;
    objective: string;
  };
  planSummary: string;
}): Partial<Record<AnalysisToolName, unknown>> {
  const intent = recognizeIntentFromQuestion(input.questionText);
  const metric = resolveSemanticMetricKey(
    input.context.targetMetric.value,
    input.questionText,
    input.groundedContext,
  );
  const authSession = buildWorkerAuthSession({
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId,
    organizationId: input.organizationId,
    projectIds: input.projectIds,
    areaIds: input.areaIds,
  });
  const projectScope = resolveProjectScope({
    context: input.context,
    currentProjectIds: input.projectIds,
    projectCatalog: input.projectCatalog,
  });
  const primaryCubeQuery: MetricQueryRequest = {
    metric,
    scope: {
      organizationId: input.organizationId,
      projectIds: projectScope.projectIds,
    },
    dateRange: resolveDateRange(metric, input.context, new Date(), input.groundedContext),
    groupBy: projectScope.projectIds.length > 1 ? ['project-name'] : undefined,
    filters: projectScope.filters,
    limit: 20,
    granularity:
      input.context.granularity?.state === 'confirmed'
        ? resolveGranularity(input.context.granularity.value)
        : undefined,
  };
  const supportingMetrics = resolveSupportingMetricKeys({
    primaryMetric: metric,
    questionText: input.questionText,
    stepId: input.step.id,
  });
  const cubeQueryInput =
    supportingMetrics.length === 0
      ? primaryCubeQuery
      : [
          primaryCubeQuery,
          ...supportingMetrics.map((supportingMetric) => ({
            metric: supportingMetric,
            scope: primaryCubeQuery.scope,
            dateRange: resolveDateRange(supportingMetric, input.context, new Date()),
            groupBy: primaryCubeQuery.groupBy,
            filters: primaryCubeQuery.filters,
            limit: 20,
          } satisfies MetricQueryRequest)),
        ];

  return {
    'platform.capability-status': {},
    'llm.structured-analysis': {
      taskType: 'conclusion-summary' as const,
      input: {
        questionText: input.questionText,
        evidenceSummary: [
          `步骤：${input.step.title}`,
          `目标：${input.step.objective}`,
          `指标：${input.context.targetMetric.value}`,
          `实体：${input.context.entity.value}`,
          `时间：${input.context.timeRange.value}`,
        ].join('\n'),
      },
      context: {
        userId: input.ownerUserId,
        organizationId: input.organizationId,
        purpose: 'analysis-execution',
        timeoutMs: 60_000,
        sessionId: input.sessionId,
      },
    },
    'cube.semantic-query': cubeQueryInput,
    'neo4j.graph-query': {
      intentType: intent.type,
      metric: input.context.targetMetric.value,
      entity: input.context.entity.value,
      timeRange: input.context.timeRange.value,
      questionText: input.questionText,
    },
    'erp.read-model': {
      resource: resolveErpResource(input.questionText),
      session: authSession,
    },
  };
}
