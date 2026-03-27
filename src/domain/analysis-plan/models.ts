import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type { CandidateFactor } from '@/domain/factor-expansion/models';

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
};

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
