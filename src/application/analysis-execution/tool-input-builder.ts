import type { SemanticMetricKey } from '@/application/semantic-query/models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import { recognizeIntentFromQuestion } from '@/domain/analysis-intent/models';
import type { AuthSession } from '@/domain/auth/models';
import type { AnalysisToolName } from '@/domain/tooling/models';

export function resolveSemanticMetricKey(
  metricValue: string,
  questionText: string,
): SemanticMetricKey {
  const usesTailArrearsSemantics =
    /尾欠|历史欠费|跨年未收|历史遗留/.test(metricValue) ||
    /尾欠|历史欠费|跨年未收|历史遗留/.test(questionText);

  if (/应收/.test(metricValue) || /应收/.test(questionText)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-receivable-amount'
      : 'project-receivable-amount';
  }

  if (/实收|回款金额/.test(metricValue) || /实收|回款金额/.test(questionText)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-paid-amount'
      : 'project-paid-amount';
  }

  if (/投诉/.test(metricValue) || /投诉/.test(questionText)) {
    return 'complaint-count';
  }

  if (/满意度|评分/.test(metricValue) || /满意度|评分/.test(questionText)) {
    return 'average-satisfaction';
  }

  if (/响应/.test(metricValue) || /响应/.test(questionText)) {
    return 'average-response-duration-hours';
  }

  if (/关闭时长|完工时长/.test(metricValue) || /关闭时长|完工时长/.test(questionText)) {
    return 'average-close-duration-hours';
  }

  if (/工单|报修|维修/.test(metricValue) || /工单|报修|维修/.test(questionText)) {
    return 'service-order-count';
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

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function resolveDateRange(
  metric: SemanticMetricKey,
  context: AnalysisContext,
  now: Date = new Date(),
) {
  const value = context.timeRange.value;
  const current = new Date(now);

  if (/本月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth(), 1);
    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/上月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const to = new Date(current.getFullYear(), current.getMonth(), 0);
    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(to),
    };
  }

  if (/近三个月|最近三个月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth() - 2, 1);
    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/本季度/.test(value)) {
    const quarterMonth = Math.floor(current.getMonth() / 3) * 3;
    const from = new Date(current.getFullYear(), quarterMonth, 1);
    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/今年/.test(value)) {
    const from = new Date(current.getFullYear(), 0, 1);
    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/去年/.test(value)) {
    const from = new Date(current.getFullYear() - 1, 0, 1);
    const to = new Date(current.getFullYear() - 1, 11, 31);
    return {
      dimension: resolveDateDimension(metric),
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
  );
  const authSession = buildWorkerAuthSession({
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId,
    organizationId: input.organizationId,
    projectIds: input.projectIds,
    areaIds: input.areaIds,
  });

  return {
    'platform.capability-status': {},
    'llm.structured-analysis': {
      taskType: 'conclusion-summary' as const,
      model: 'bailian/qwen3.6-plus',
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
    'cube.semantic-query': {
      metric,
      scope: {
        organizationId: input.organizationId,
        projectIds: input.projectIds,
      },
      dateRange: resolveDateRange(metric, input.context),
      groupBy: input.projectIds.length > 1 ? ['project-name'] : undefined,
      limit: 20,
    },
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
