import { SUPPORTED_ANALYSIS_TOPICS } from '@/domain/scope-boundary/policy';

export const ANALYSIS_INTENT_TYPES = [
  'fee-analysis',
  'work-order-analysis',
  'complaint-analysis',
  'satisfaction-analysis',
  'general-analysis',
] as const;

export type AnalysisIntentType = (typeof ANALYSIS_INTENT_TYPES)[number];

export type AnalysisIntent = {
  id: string;
  sessionId: string;
  type: AnalysisIntentType;
  goal: string;
  createdAt: string;
};

const INTENT_TYPE_LABELS: Record<AnalysisIntentType, string> = {
  'fee-analysis': '收费分析',
  'work-order-analysis': '工单分析',
  'complaint-analysis': '投诉分析',
  'satisfaction-analysis': '满意度分析',
  'general-analysis': '综合分析',
};

export function getIntentTypeLabel(type: AnalysisIntentType): string {
  return INTENT_TYPE_LABELS[type];
}

type IntentRule = {
  type: AnalysisIntentType;
  topic: (typeof SUPPORTED_ANALYSIS_TOPICS)[number];
  patterns: RegExp[];
};

const INTENT_RULES: IntentRule[] = [
  {
    type: 'fee-analysis',
    topic: '收费',
    patterns: [/收费/, /回款/, /缴费/, /欠费/, /账单/, /费用/],
  },
  {
    type: 'work-order-analysis',
    topic: '工单',
    patterns: [/工单/, /维修/, /报修/, /派单/, /完工/],
  },
  {
    type: 'complaint-analysis',
    topic: '投诉',
    patterns: [/投诉/, /申诉/, /不满/, /举报/],
  },
  {
    type: 'satisfaction-analysis',
    topic: '满意度',
    patterns: [/满意度/, /评价/, /评分/, /好评/, /差评/],
  },
];

export type IntentRecognitionResult = {
  type: AnalysisIntentType;
  goal: string;
};

export function recognizeIntentFromQuestion(
  questionText: string,
): IntentRecognitionResult {
  for (const rule of INTENT_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(questionText));

    if (matched) {
      return {
        type: rule.type,
        goal: `针对"${rule.topic}"领域的分析：${questionText}`,
      };
    }
  }

  return {
    type: 'general-analysis',
    goal: `综合物业数据分析：${questionText}`,
  };
}
