import { normalizeQuestionText } from '@/domain/analysis-session/models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';

export const FACTOR_EXPANSION_MODES = ['expand', 'skip'] as const;

export type FactorExpansionMode = (typeof FACTOR_EXPANSION_MODES)[number];

export type CandidateFactor = {
  key: string;
  label: string;
  rationale: string;
};

export type CandidateFactorExpansion = {
  mode: FactorExpansionMode;
  disclaimer: string;
  factors: CandidateFactor[];
  skipReason?: string;
};

type FactorTemplate = {
  key: string;
  label: string;
  rationale: (input: {
    metric: string;
    entity: string;
    timeRange: string;
  }) => string;
};

const CAUSAL_PATTERNS = [
  /为什么/,
  /原因/,
  /影响/,
  /导致/,
  /归因/,
  /异常/,
  /波动/,
  /下降/,
  /上升/,
  /变动/,
] as const;

const FACTOR_TEMPLATES: Record<AnalysisIntentType, FactorTemplate[]> = {
  'fee-analysis': [
    {
      key: 'fee-policy-reach',
      label: '收费政策触达',
      rationale: ({ metric, entity, timeRange }) =>
        `${entity}在${timeRange}的${metric}会直接受到收费政策、触达频次和通知覆盖情况影响，因此需要先核对收费政策触达是否发生变化。`,
    },
    {
      key: 'work-order-response',
      label: '工单响应时效',
      rationale: ({ metric, entity }) =>
        `${entity}若存在维修、报修处理延迟，往往会影响业主缴费意愿和回款节奏，因此工单响应时效与当前${metric}存在联动可能。`,
    },
    {
      key: 'billing-timeliness',
      label: '账单生成及时性',
      rationale: ({ metric, timeRange }) =>
        `${timeRange}内账单生成或推送是否及时，会影响用户是否能按时完成缴费，是${metric}波动时常见的前置检查方向。`,
    },
  ],
  'work-order-analysis': [
    {
      key: 'dispatch-load',
      label: '派单负荷分布',
      rationale: ({ metric, entity, timeRange }) =>
        `${entity}在${timeRange}内的派单负荷如果分布不均，容易拉低${metric}，因此需要优先检查不同班组或项目的派单承压情况。`,
    },
    {
      key: 'material-readiness',
      label: '备件与材料准备',
      rationale: ({ metric, entity }) =>
        `${entity}的备件或材料准备不足，会直接拖慢处理闭环，对${metric}形成明显影响。`,
    },
    {
      key: 'sla-exception',
      label: 'SLA 例外占比',
      rationale: ({ metric, timeRange }) =>
        `${timeRange}内若特殊工单、例外工单占比上升，${metric}通常会出现结构性变化，因此需要把 SLA 例外占比纳入候选因素。`,
    },
  ],
  'complaint-analysis': [
    {
      key: 'service-response',
      label: '服务响应及时性',
      rationale: ({ metric, entity }) =>
        `${entity}的服务响应及时性与${metric}高度相关，响应时间拉长通常会先体现在投诉增多。`,
    },
    {
      key: 'repeat-issue',
      label: '重复问题复发',
      rationale: ({ metric, timeRange }) =>
        `${timeRange}内重复问题是否反复出现，会影响${metric}的异常波动，是投诉类分析中的常见候选方向。`,
    },
  ],
  'satisfaction-analysis': [
    {
      key: 'service-fulfillment',
      label: '服务兑现程度',
      rationale: ({ metric, entity }) =>
        `${entity}的服务兑现程度变化，通常会先反映在${metric}上，因此需要检查承诺兑现、回访完成和问题闭环情况。`,
    },
    {
      key: 'complaint-spillover',
      label: '投诉外溢影响',
      rationale: ({ metric, timeRange }) =>
        `${timeRange}内若投诉问题没有被及时闭环，往往会外溢影响${metric}，因此该方向需要作为候选因素保留。`,
    },
  ],
  'general-analysis': [
    {
      key: 'process-execution',
      label: '流程执行一致性',
      rationale: ({ metric, entity }) =>
        `${entity}的流程执行一致性变化，可能影响当前${metric}，可作为通用候选方向进行后续验证。`,
    },
    {
      key: 'staffing-change',
      label: '人力配置变化',
      rationale: ({ metric, timeRange }) =>
        `${timeRange}内人力配置或班次变化，常会造成${metric}波动，因此适合作为综合分析的候选因素。`,
    },
  ],
};

function getContextValue(
  value: string,
  fallback: string,
  missingTokens: string[],
): string {
  if (missingTokens.includes(value)) {
    return fallback;
  }

  return value;
}

export function shouldExpandCandidateFactors(questionText: string): boolean {
  const normalizedQuestionText = normalizeQuestionText(questionText);
  return CAUSAL_PATTERNS.some((pattern) => pattern.test(normalizedQuestionText));
}

export function expandCandidateFactors(input: {
  intentType: AnalysisIntentType;
  questionText: string;
  context: AnalysisContext;
}): CandidateFactorExpansion {
  if (!shouldExpandCandidateFactors(input.questionText)) {
    return {
      mode: 'skip',
      disclaimer: '当前问题更像直接查询或基础对比，系统已跳过候选因素扩展。',
      skipReason: '已跳过候选因素扩展',
      factors: [],
    };
  }

  const templates =
    FACTOR_TEMPLATES[input.intentType] ?? FACTOR_TEMPLATES['general-analysis'];
  const metric = getContextValue(input.context.targetMetric.value, '当前目标指标', [
    '待补充目标指标',
    '指标描述不够具体',
  ]);
  const entity = getContextValue(input.context.entity.value, '当前分析对象', [
    '待补充实体对象',
  ]);
  const timeRange = getContextValue(input.context.timeRange.value, '当前分析周期', [
    '待补充时间范围',
  ]);

  return {
    mode: 'expand',
    disclaimer: '这些因素不是最终结论，而是系统为了后续归因验证而扩展出的候选方向。',
    factors: templates.map((template) => ({
      key: template.key,
      label: template.label,
      rationale: template.rationale({
        metric,
        entity,
        timeRange,
      }),
    })),
  };
}
