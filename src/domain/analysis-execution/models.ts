import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisPlan } from '@/domain/analysis-plan/models';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';
import { getPlanOntologyVersionId } from '@/domain/ontology/version-binding';

export type AnalysisExecutionPlanSnapshot = AnalysisPlan;

export type AnalysisExecutionJobData = {
  sessionId: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  followUpId: string | null;
  questionText: string;
  context?: AnalysisContext;
  groundedContext?: OntologyGroundedContext;
  ontologyVersionId?: string;
  submittedAt: string;
  plan: AnalysisExecutionPlanSnapshot;
  // Story 7.4 D2: 承载 web 端发起执行时的 correlation id，
  // worker 用它把后续处理纳入同一条 trace，修复 AC3 "跨进程定位问题范围"。
  originCorrelationId?: string;
};

export class InvalidAnalysisExecutionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisExecutionPlanError';
  }
}

function assertNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidAnalysisExecutionPlanError(`${fieldName} 不能为空。`);
  }

  return value.trim();
}

function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new InvalidAnalysisExecutionPlanError(`${fieldName} 必须是字符串数组。`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

export function validateAnalysisExecutionPlanSnapshot(
  plan: AnalysisExecutionPlanSnapshot,
) {
  if (!plan || typeof plan !== 'object') {
    throw new InvalidAnalysisExecutionPlanError('执行计划不能为空。');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new InvalidAnalysisExecutionPlanError('执行计划至少包含一个步骤。');
  }

  const stepIds = new Set<string>();

  plan.steps.forEach((step, index) => {
    const expectedOrder = index + 1;

    if (step.order !== expectedOrder) {
      throw new InvalidAnalysisExecutionPlanError(
        `步骤顺序必须连续，当前期望步骤 ${expectedOrder}。`,
      );
    }

    if (!step.id.trim()) {
      throw new InvalidAnalysisExecutionPlanError('步骤 ID 不能为空。');
    }

    if (stepIds.has(step.id)) {
      throw new InvalidAnalysisExecutionPlanError('步骤 ID 不能重复。');
    }

    stepIds.add(step.id);

    if (!step.title.trim()) {
      throw new InvalidAnalysisExecutionPlanError('步骤标题不能为空。');
    }

    if (!step.objective.trim()) {
      throw new InvalidAnalysisExecutionPlanError('步骤目标不能为空。');
    }

    if (
      !Array.isArray(step.dependencyIds) ||
      step.dependencyIds.some((dependencyId) => typeof dependencyId !== 'string')
    ) {
      throw new InvalidAnalysisExecutionPlanError('步骤依赖必须是字符串数组。');
    }
  });

  plan.steps.forEach((step) => {
    step.dependencyIds.forEach((dependencyId) => {
      if (!stepIds.has(dependencyId)) {
        throw new InvalidAnalysisExecutionPlanError(
          `步骤依赖 ${dependencyId} 不存在。`,
        );
      }
    });
  });

  return plan;
}

export function validateAnalysisExecutionJobData(
  data: unknown,
): AnalysisExecutionJobData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new InvalidAnalysisExecutionPlanError('执行任务数据必须是对象。');
  }

  const candidate = data as Record<string, unknown>;
  const followUpId =
    candidate.followUpId === null || candidate.followUpId === undefined
      ? null
      : assertNonEmptyString(candidate.followUpId, 'followUpId');

  const plan = validateAnalysisExecutionPlanSnapshot(
    candidate.plan as AnalysisExecutionPlanSnapshot,
  );
  const ontologyVersionId =
    typeof candidate.ontologyVersionId === 'string' &&
    candidate.ontologyVersionId.trim().length > 0
      ? candidate.ontologyVersionId.trim()
      : getPlanOntologyVersionId(plan) ?? undefined;

  return {
    sessionId: assertNonEmptyString(candidate.sessionId, 'sessionId'),
    ownerUserId: assertNonEmptyString(candidate.ownerUserId, 'ownerUserId'),
    organizationId: assertNonEmptyString(
      candidate.organizationId,
      'organizationId',
    ),
    projectIds: assertStringArray(candidate.projectIds, 'projectIds'),
    areaIds: assertStringArray(candidate.areaIds, 'areaIds'),
    followUpId,
    questionText: assertNonEmptyString(candidate.questionText, 'questionText'),
    context:
      candidate.context && typeof candidate.context === 'object'
        ? (candidate.context as AnalysisContext)
        : undefined,
    groundedContext:
      candidate.groundedContext && typeof candidate.groundedContext === 'object'
        ? (candidate.groundedContext as OntologyGroundedContext)
        : undefined,
    ontologyVersionId,
    submittedAt: assertNonEmptyString(candidate.submittedAt, 'submittedAt'),
    plan,
    originCorrelationId:
      typeof candidate.originCorrelationId === 'string' &&
      candidate.originCorrelationId.trim().length > 0
        ? candidate.originCorrelationId.trim()
        : undefined,
  };
}
