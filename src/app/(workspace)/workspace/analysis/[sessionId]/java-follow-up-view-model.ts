import type { AnalysisHistoryReadModel } from '@/application/analysis-history/use-cases';
import type { AnalysisSessionFollowUp, FollowUpContextChangeItem } from '@/domain/analysis-session/follow-up-models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import { createOntologyVersionBinding } from '@/domain/ontology/version-binding';
import type { JavaAnalysisSession } from '@/infrastructure/java-backend';

type SearchParams = Record<string, string | string[] | undefined>;

const conflictType = new Set(['field', 'constraint']);

function read(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function parseConflicts(value: string | string[] | undefined): FollowUpContextChangeItem[] {
  const raw = read(value);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FollowUpContextChangeItem => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.type === 'string'
        && conflictType.has(candidate.type)
        && typeof candidate.key === 'string'
        && candidate.key.length > 0
        && typeof candidate.label === 'string'
        && candidate.label.length > 0
        && typeof candidate.nextValue === 'string'
        && candidate.nextValue.length > 0
        && (candidate.previousValue === undefined || typeof candidate.previousValue === 'string');
    });
  } catch {
    return [];
  }
}

export function followUpsFromJava(aggregate: JavaAnalysisSession): AnalysisSessionFollowUp[] {
  return aggregate.followUps.map((followUp) => ({
    ...followUp,
    currentPlanSnapshot: followUp.currentPlanSnapshot as AnalysisSessionFollowUp['currentPlanSnapshot'],
    previousPlanSnapshot: followUp.previousPlanSnapshot as AnalysisSessionFollowUp['previousPlanSnapshot'],
  }));
}

export function resolveJavaActiveFollowUp(
  followUps: AnalysisSessionFollowUp[],
  requestedId?: string,
) {
  return followUps.find((followUp) => followUp.id === requestedId) ?? followUps.at(-1) ?? null;
}

export function rootContextFromJava(aggregate: JavaAnalysisSession): AnalysisContext | null {
  const resolved = aggregate.history.find((round) => round.kind === 'initial')
    ?.planSnapshot?._resolvedContext;
  if (!resolved
    || typeof resolved.entityKey !== 'string'
    || typeof resolved.metricDefinitionKey !== 'string'
    || typeof resolved.metricVariantKey !== 'string'
    || typeof resolved.timeSemanticKey !== 'string'
    || typeof resolved.from !== 'string'
    || typeof resolved.to !== 'string'
    || !Array.isArray(resolved.projectIds)
    || resolved.projectIds.some((id) => typeof id !== 'string' || !id)) {
    return null;
  }

  const projectIds = resolved.projectIds as string[];
  return {
    targetMetric: { label: '目标指标', value: resolved.metricVariantKey, state: 'confirmed' },
    entity: {
      label: '实体对象',
      value: projectIds.length ? projectIds.join(',') : resolved.entityKey,
      state: 'confirmed',
    },
    timeRange: { label: '时间范围', value: `${resolved.from}/${resolved.to}`, state: 'confirmed' },
    comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
    constraints: [
      { label: '实体 business key', value: resolved.entityKey },
      { label: '指标定义 business key', value: resolved.metricDefinitionKey },
      { label: '指标口径 business key', value: resolved.metricVariantKey },
      { label: '时间语义 business key', value: resolved.timeSemanticKey },
      ...projectIds.map((id) => ({ label: '项目 ID', value: id })),
    ],
  };
}

function contextSummary(context: AnalysisContext) {
  return [
    `指标：${context.targetMetric.value}`,
    `实体：${context.entity.value}`,
    `时间：${context.timeRange.value}`,
  ];
}

export function buildJavaHistoryReadModel(
  aggregate: JavaAnalysisSession,
  selectedRoundId?: string,
): AnalysisHistoryReadModel {
  const followUpById = new Map(aggregate.followUps.map((item) => [item.id, item]));
  const rootRound = aggregate.history[0];
  const rootResolved = rootRound?.planSnapshot?._resolvedContext;
  const rootSummary = rootResolved
    ? [
        `指标：${String(rootResolved.metricVariantKey)}`,
        `实体：${(rootResolved.projectIds as string[]).join('、') || String(rootResolved.entityKey)}`,
        `时间：${String(rootResolved.from)}/${String(rootResolved.to)}`,
      ]
    : [];
  const rounds = aggregate.history.map((round, index) => {
    const followUp = round.followUpId ? followUpById.get(round.followUpId) : null;
    const cause = round.conclusionState?.causes[0] ?? null;
    const steps = round.planSnapshot?.steps;
    const planSteps = Array.isArray(steps)
      ? steps.map((step) => step as { order: number; title: string })
      : [];
    return {
      id: round.id,
      kind: round.kind,
      label: round.kind === 'initial' ? '初始分析' : `第 ${index} 轮追问`,
      questionText: round.questionText,
      createdAt: round.createdAt,
      followUpId: round.followUpId,
      executionId: round.executionId,
      ontologyVersionBinding: createOntologyVersionBinding(
        round.ontologyVersionId,
        round.ontologyVersionBindingSource === 'grounded-context'
          || round.ontologyVersionBindingSource === 'inherited'
          || round.ontologyVersionBindingSource === 'switched'
          ? round.ontologyVersionBindingSource
          : undefined,
      ),
      status: round.status ?? 'pending',
      inputSummary: followUp ? contextSummary(followUp.mergedContext) : rootSummary,
      planSummary: typeof round.planSnapshot?.summary === 'string' ? round.planSnapshot.summary : null,
      planSteps,
      conclusionTitle: cause?.title ?? null,
      conclusionSummary: cause?.summary ?? null,
      evidence: cause?.evidence ?? [],
      isLatest: index === aggregate.history.length - 1,
    };
  });

  return {
    rounds,
    selectedRound: rounds.find((round) => round.id === selectedRoundId) ?? rounds.at(-1) ?? null,
    latestRoundId: rounds.at(-1)?.id ?? null,
  };
}

export function buildJavaFollowUpFeedback(searchParams: SearchParams) {
  const error = read(searchParams.followUpError)
    ?? read(searchParams.followUpAdjustmentError)
    ?? read(searchParams.followUpExecutionError);
  const updated = read(searchParams.followUpContextUpdated);
  const replanError = read(searchParams.followUpReplanError);
  return {
    adjustmentDraft: {
      targetMetric: read(searchParams.targetMetric),
      entity: read(searchParams.entity),
      timeRange: read(searchParams.timeRange),
      comparison: read(searchParams.comparison),
      factor: read(searchParams.factor),
    },
    conflictItems: parseConflicts(searchParams.followUpConflict),
    feedback: error
      ? { tone: 'error' as const, message: error }
      : updated
        ? {
            tone: 'success' as const,
            message: updated === 'conflict-confirmed'
              ? '冲突条件已确认并更新到当前轮次上下文。'
              : '当前轮次上下文已合并新增条件。',
          }
        : read(searchParams.followUpId)
          ? { tone: 'success' as const, message: '追问已附着到当前会话。' }
          : null,
    replanFeedback: replanError
      ? { tone: 'error' as const, message: replanError }
      : read(searchParams.followUpReplanned)
        ? { tone: 'success' as const, message: '已根据纠正后的上下文重生成后续计划。' }
        : null,
  };
}
