import type { AnalysisPlan } from '@/domain/analysis-plan/models';

export type AnalysisExecutionPlanSnapshot = AnalysisPlan;

export type AnalysisExecutionJobData = {
  sessionId: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  questionText: string;
  submittedAt: string;
  plan: AnalysisExecutionPlanSnapshot;
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

  return {
    sessionId: assertNonEmptyString(candidate.sessionId, 'sessionId'),
    ownerUserId: assertNonEmptyString(candidate.ownerUserId, 'ownerUserId'),
    organizationId: assertNonEmptyString(
      candidate.organizationId,
      'organizationId',
    ),
    projectIds: assertStringArray(candidate.projectIds, 'projectIds'),
    areaIds: assertStringArray(candidate.areaIds, 'areaIds'),
    questionText: assertNonEmptyString(candidate.questionText, 'questionText'),
    submittedAt: assertNonEmptyString(candidate.submittedAt, 'submittedAt'),
    plan: validateAnalysisExecutionPlanSnapshot(
      candidate.plan as AnalysisExecutionPlanSnapshot,
    ),
  };
}
