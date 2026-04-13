import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type { CandidateFactor } from '@/domain/factor-expansion/models';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';

export const ANALYSIS_PLAN_MODES = ['minimal', 'multi-step'] as const;

export type AnalysisPlanMode = (typeof ANALYSIS_PLAN_MODES)[number];

export type AnalysisPlanStep = {
  id: string;
  order: number;
  title: string;
  objective: string;
  dependencyIds: string[];
};

export type AnalysisPlan = {
  mode: AnalysisPlanMode;
  summary: string;
  steps: AnalysisPlanStep[];
  _groundedSource?: string;
  _groundingStatus?: OntologyGroundedContext['groundingStatus'];
};

export type AnalysisPlanDiffStep = {
  stepId: string;
  title: string;
  reason: string;
};

export type AnalysisPlanDiff = {
  reason: string;
  reusedSteps: AnalysisPlanDiffStep[];
  invalidatedSteps: AnalysisPlanDiffStep[];
  addedSteps: AnalysisPlanDiffStep[];
};

function buildStepSignature(step: AnalysisPlanStep) {
  return JSON.stringify({
    id: step.id,
    title: step.title,
    objective: step.objective,
    dependencyIds: step.dependencyIds,
  });
}

export function buildAnalysisPlanDiff(input: {
  previousPlan: AnalysisPlan;
  nextPlan: AnalysisPlan;
  reusableCompletedStepIds: string[];
  reason: string;
}): AnalysisPlanDiff {
  const previousById = new Map(
    input.previousPlan.steps.map((step) => [step.id, step]),
  );
  const previousSignatureById = new Map(
    input.previousPlan.steps.map((step) => [step.id, buildStepSignature(step)]),
  );
  const reusableCompletedStepIds = new Set(input.reusableCompletedStepIds);
  const invalidatedStepIds = new Set<string>();
  const reusedSteps: AnalysisPlanDiffStep[] = [];
  const invalidatedSteps: AnalysisPlanDiffStep[] = [];
  const addedSteps: AnalysisPlanDiffStep[] = [];

  input.previousPlan.steps.forEach((previousStep) => {
    const nextStep = input.nextPlan.steps.find((step) => step.id === previousStep.id);

    if (!nextStep) {
      invalidatedStepIds.add(previousStep.id);
      invalidatedSteps.push({
        stepId: previousStep.id,
        title: previousStep.title,
        reason: '该步骤不再出现在新计划中。',
      });
      return;
    }

    if (buildStepSignature(nextStep) !== buildStepSignature(previousStep)) {
      invalidatedStepIds.add(previousStep.id);
      invalidatedSteps.push({
        stepId: previousStep.id,
        title: previousStep.title,
        reason: '步骤定义发生变化，上一轮结果不可直接复用。',
      });
      addedSteps.push({
        stepId: nextStep.id,
        title: nextStep.title,
        reason: '该步骤已按新的上下文重新生成。',
      });
    }
  });

  input.nextPlan.steps.forEach((nextStep) => {
    const previousStep = previousById.get(nextStep.id);
    const hasSameDefinition =
      previousStep &&
      previousSignatureById.get(nextStep.id) === buildStepSignature(nextStep);

    if (!previousStep) {
      addedSteps.push({
        stepId: nextStep.id,
        title: nextStep.title,
        reason: '该步骤是新计划新增的后续动作。',
      });
      return;
    }

    if (!hasSameDefinition) {
      return;
    }

    const hasReusableResult = reusableCompletedStepIds.has(nextStep.id);
    const hasInvalidDependency = nextStep.dependencyIds.some((dependencyId) =>
      invalidatedStepIds.has(dependencyId),
    );

    if (hasReusableResult && !hasInvalidDependency) {
      reusedSteps.push({
        stepId: nextStep.id,
        title: nextStep.title,
        reason: '步骤定义未变，且上一轮已有完成结果可复用。',
      });
      return;
    }

    if (hasInvalidDependency) {
      invalidatedStepIds.add(nextStep.id);
      invalidatedSteps.push({
        stepId: nextStep.id,
        title: nextStep.title,
        reason: '依赖步骤已失效，需要重新执行。',
      });
    }
  });

  return {
    reason: input.reason,
    reusedSteps,
    invalidatedSteps,
    addedSteps,
  };
}

function getDisplayValue(value: string, fallback: string, placeholders: string[]) {
  if (placeholders.includes(value)) {
    return fallback;
  }

  return value;
}

function buildScopeSummary(context: AnalysisContext) {
  const metric = getDisplayValue(context.targetMetric.value, '当前目标指标', [
    '待补充目标指标',
    '指标描述不够具体',
  ]);
  const entity = getDisplayValue(context.entity.value, '当前分析对象', [
    '待补充实体对象',
  ]);
  const timeRange = getDisplayValue(context.timeRange.value, '当前分析周期', [
    '待补充时间范围',
  ]);

  return {
    metric,
    entity,
    timeRange,
  };
}

export function buildAnalysisPlan(input: {
  intentType: AnalysisIntentType;
  context: AnalysisContext;
  candidateFactors: CandidateFactor[];
  shouldExpandFactors: boolean;
}): AnalysisPlan {
  const scope = buildScopeSummary(input.context);

  if (!input.shouldExpandFactors) {
    return {
      mode: 'minimal',
      summary: '这是一个极简计划，系统会先确认查询口径，再返回指标结果或基础对比。',
      steps: [
        {
          id: 'confirm-query-scope',
          order: 1,
          title: '确认查询口径',
          objective: `确认${scope.metric}的统计口径，并补齐${scope.entity}、${scope.timeRange}等必要范围信息。`,
          dependencyIds: [],
        },
        {
          id: 'return-metric-result',
          order: 2,
          title: '返回指标结果',
          objective: `基于确认后的范围返回${scope.metric}结果，必要时提供基础对比或趋势说明。`,
          dependencyIds: ['confirm-query-scope'],
        },
      ],
    };
  }

  const factorPreview = input.candidateFactors
    .slice(0, 2)
    .map((factor) => factor.label)
    .join('、');

  return {
    mode: 'multi-step',
    summary: '这是本次复杂问题的计划骨架，系统会先确认口径，再逐步验证候选方向，最后汇总归因判断。',
    steps: [
      {
        id: 'confirm-analysis-scope',
        order: 1,
        title: '确认分析口径',
        objective: `确认${scope.metric}、${scope.entity}和${scope.timeRange}的分析边界，确保后续步骤基于同一口径推进。`,
        dependencyIds: [],
      },
      {
        id: 'inspect-metric-change',
        order: 2,
        title: '校验核心指标波动',
        objective: `先验证${scope.metric}是否真实发生波动，并定位波动主要集中在哪些实体或时间切片。`,
        dependencyIds: ['confirm-analysis-scope'],
      },
      {
        id: 'validate-candidate-factors',
        order: 3,
        title: '逐项验证候选因素',
        objective:
          factorPreview.length > 0
            ? `围绕${factorPreview}等候选方向逐项查证，识别哪些因素值得进入下一轮验证。`
            : '围绕当前会话扩展出的候选方向逐项查证，识别哪些因素值得进入下一轮验证。',
        dependencyIds: ['confirm-analysis-scope', 'inspect-metric-change'],
      },
      {
        id: 'synthesize-attribution',
        order: 4,
        title: '汇总归因判断',
        objective: '汇总前序步骤形成的证据，整理出待验证的归因判断，并为后续执行与证据展示做好准备。',
        dependencyIds: ['inspect-metric-change', 'validate-candidate-factors'],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Grounded Context 支持 (Story 9.3)
// ---------------------------------------------------------------------------

export type GroundedAnalysisPlanInput = {
  intentType: AnalysisIntentType;
  groundedContext: OntologyGroundedContext;
  shouldExpandFactors: boolean;
};

export class InvalidGroundedAnalysisPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGroundedAnalysisPlanError';
  }
}

function getRequiredGroundedDefinitionDisplayName(
  items: Array<{
    status: 'success' | 'ambiguous' | 'failed';
    originalText: string;
    canonicalDefinition: { displayName: string } | null;
  }>,
  label: string,
) {
  const matched = items.find(
    (item) => item.status === 'success' && item.canonicalDefinition,
  );

  if (!matched?.canonicalDefinition) {
    throw new InvalidGroundedAnalysisPlanError(
      `缺少可用的治理化${label}定义，无法生成 grounded plan。`,
    );
  }

  return matched.originalText || matched.canonicalDefinition.displayName;
}

/**
 * 基于 Ontology Grounded Context 构建分析计划
 *
 * AC2: planner 消费 grounded definitions 而不是自由文本
 */
export function buildAnalysisPlanFromGroundedContext(input: GroundedAnalysisPlanInput): AnalysisPlan & {
  _groundedSource: string; // ontologyVersionId 引用
  _groundingStatus: OntologyGroundedContext['groundingStatus'];
} {
  const metric = getRequiredGroundedDefinitionDisplayName(
    input.groundedContext.metrics,
    '指标',
  );
  const entity = getRequiredGroundedDefinitionDisplayName(
    input.groundedContext.entities,
    '实体',
  );
  const timeRange = getRequiredGroundedDefinitionDisplayName(
    input.groundedContext.timeSemantics,
    '时间语义',
  );

  // 构建 steps，使用 grounded factors 而非 raw candidate factors
  const groundedFactorLabels = input.groundedContext.factors
    .filter((f) => f.status === 'success' && f.canonicalDefinition)
    .map((f) => f.originalText || f.canonicalDefinition!.displayName);

  const factorPreview = groundedFactorLabels.length > 0
    ? groundedFactorLabels.slice(0, 2).join('、')
    : '';

  if (!input.shouldExpandFactors) {
    return {
      mode: 'minimal',
      summary: '这是一个极简计划，系统会先确认查询口径，再返回指标结果或基础对比。',
      steps: [
        {
          id: 'confirm-query-scope',
          order: 1,
          title: '确认查询口径',
          objective: `确认${metric}的统计口径，并补齐${entity}、${timeRange}等必要范围信息。`,
          dependencyIds: [],
        },
        {
          id: 'return-metric-result',
          order: 2,
          title: '返回指标结果',
          objective: `基于确认后的范围返回${metric}结果，必要时提供基础对比或趋势说明。`,
          dependencyIds: ['confirm-query-scope'],
        },
      ],
      _groundedSource: input.groundedContext.ontologyVersionId,
      _groundingStatus: input.groundedContext.groundingStatus,
    };
  }

  return {
    mode: 'multi-step',
    summary: '这是本次复杂问题的计划骨架，系统会先确认口径，再逐步验证候选方向，最后汇总归因判断。',
    steps: [
      {
        id: 'confirm-analysis-scope',
        order: 1,
        title: '确认分析口径',
        objective: `确认${metric}、${entity}和${timeRange}的分析边界，确保后续步骤基于同一口径推进。`,
        dependencyIds: [],
      },
      {
        id: 'inspect-metric-change',
        order: 2,
        title: '校验核心指标波动',
        objective: `先验证${metric}是否真实发生波动，并定位波动主要集中在哪些实体或时间切片。`,
        dependencyIds: ['confirm-analysis-scope'],
      },
      {
        id: 'validate-candidate-factors',
        order: 3,
        title: '逐项验证候选因素',
        objective: factorPreview.length > 0
          ? `围绕${factorPreview}等候选方向逐项查证，识别哪些因素值得进入下一轮验证。`
          : '围绕当前会话扩展出的候选方向逐项查证，识别哪些因素值得进入下一轮验证。',
        dependencyIds: ['confirm-analysis-scope', 'inspect-metric-change'],
      },
      {
        id: 'synthesize-attribution',
        order: 4,
        title: '汇总归因判断',
        objective: '汇总前序步骤形成的证据，整理出待验证的归因判断，并为后续执行与证据展示做好准备。',
        dependencyIds: ['inspect-metric-change', 'validate-candidate-factors'],
      },
    ],
    _groundedSource: input.groundedContext.ontologyVersionId,
    _groundingStatus: input.groundedContext.groundingStatus,
  };
}
