import { normalizeQuestionText } from '@/domain/analysis-session/models';

export const ANALYSIS_CONTEXT_FIELD_STATES = [
  'missing',
  'uncertain',
  'confirmed',
] as const;

export type AnalysisContextFieldState =
  (typeof ANALYSIS_CONTEXT_FIELD_STATES)[number];

export type AnalysisContextField = {
  label: string;
  value: string;
  state: AnalysisContextFieldState;
  note?: string;
};

export type AnalysisContextConstraint = {
  label: string;
  value: string;
};

export type AnalysisContext = {
  targetMetric: AnalysisContextField;
  entity: AnalysisContextField;
  timeRange: AnalysisContextField;
  comparison: AnalysisContextField;
  constraints: AnalysisContextConstraint[];
};

type ExtractionResult = {
  value: string;
  state: AnalysisContextFieldState;
  note?: string;
};

const METRIC_RULES: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: '收缴率',
    pattern: /收缴率/,
  },
  {
    label: '收费回款率',
    pattern: /收费回款率|回款率/,
  },
  {
    label: '回款表现',
    pattern: /回款表现|回款金额|回款/,
  },
  {
    label: '收费率',
    pattern: /收费率/,
  },
  {
    label: '欠费压力',
    pattern: /欠费压力|欠费/,
  },
  {
    label: '投诉量',
    pattern: /投诉量|投诉率/,
  },
  {
    label: '工单完工率',
    pattern: /工单完工率|完工率/,
  },
  {
    label: '工单超时率',
    pattern: /工单超时率|超时率/,
  },
  {
    label: '满意度评分',
    pattern: /满意度评分|满意度/,
  },
];

const TIME_RANGE_RULES: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: '近三个月',
    pattern: /近三个月|最近三个月/,
  },
  {
    label: '本月',
    pattern: /本月/,
  },
  {
    label: '上月',
    pattern: /上月/,
  },
  {
    label: '本季度',
    pattern: /本季度/,
  },
  {
    label: '今年',
    pattern: /今年/,
  },
  {
    label: '去年',
    pattern: /去年/,
  },
];

const COMPARISON_RULES: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: '相比去年同期',
    pattern: /相比去年同期|较去年同期|与去年同期相比/,
  },
  {
    label: '同比',
    pattern: /同比/,
  },
  {
    label: '环比',
    pattern: /环比/,
  },
];

function toField(
  label: string,
  extractionResult: ExtractionResult,
): AnalysisContextField {
  return {
    label,
    value: extractionResult.value,
    state: extractionResult.state,
    note: extractionResult.note,
  };
}

function extractMetric(questionText: string): ExtractionResult {
  for (const rule of METRIC_RULES) {
    if (rule.pattern.test(questionText)) {
      return {
        value: rule.label,
        state: 'confirmed',
      };
    }
  }

  if (/收费|投诉|工单|满意度|运营/.test(questionText)) {
    return {
      value: '指标描述不够具体',
      state: 'uncertain',
      note: '请补充具体指标口径，例如收费回款率、投诉量或工单超时率。',
    };
  }

  return {
    value: '待补充目标指标',
    state: 'missing',
    note: '尚未识别到明确目标指标。',
  };
}

function extractEntity(
  questionText: string,
  constraints: AnalysisContextConstraint[],
): ExtractionResult {
  const entities: string[] = [];
  const dedupe = new Set<string>();
  const leadingClause = questionText
    .split(/[，,。；;？?]/u, 1)[0]
    ?.replace(/^(为什么|为何|请问)\s*/u, '')
    .replace(/^(近三个月|最近三个月|本月|上月|本季度|今年|去年)\s*/u, '')
    .trim();

  const pushEntity = (
    label: AnalysisContextConstraint['label'],
    value: string | null | undefined,
  ) => {
    const normalizedValue = value?.trim();

    if (!normalizedValue || dedupe.has(normalizedValue)) {
      return;
    }

    dedupe.add(normalizedValue);
    entities.push(normalizedValue);
    constraints.push({
      label,
      value: normalizedValue,
    });
  };

  const projectAfterKeywordMatch = questionText.match(
    /项目\s*(?!的)([\p{L}\p{N}_-]+)(?=[\s，,。；;？?]|$)/u,
  );

  if (projectAfterKeywordMatch?.[1]) {
    pushEntity('项目约束', `项目 ${projectAfterKeywordMatch[1]}`);
  }

  const areaAfterKeywordMatch = questionText.match(
    /区域\s*(?!的)([\p{L}\p{N}_-]+)(?=[\s，,。；;？?]|$)/u,
  );

  if (areaAfterKeywordMatch?.[1]) {
    pushEntity('区域约束', `区域 ${areaAfterKeywordMatch[1]}`);
  }

  const projectBeforeKeywordMatch = leadingClause?.match(
    /^([\p{L}\p{N}_-]{2,}项目)(?=的|$)/u,
  );

  if (projectBeforeKeywordMatch?.[1]) {
    pushEntity('项目约束', projectBeforeKeywordMatch[1]);
  }

  const areaBeforeKeywordMatch = leadingClause?.match(
    /^([\p{L}\p{N}_-]{2,}区域)(?=的|$)/u,
  );

  if (areaBeforeKeywordMatch?.[1]) {
    pushEntity('区域约束', areaBeforeKeywordMatch[1]);
  }

  if (entities.length === 0 && leadingClause) {
    const genericEntityMatch = leadingClause.match(/^([^的，,。；;？?]{2,40})的/u);
    const genericEntity = genericEntityMatch?.[1]?.trim();

    if (
      genericEntity &&
      !/收缴率|收费回款率|收费率|回款表现|回款|欠费压力|欠费|投诉量|投诉|满意度|工单|异常|变化|波动|原因|表现|特点/u.test(
        genericEntity,
      )
    ) {
      pushEntity('实体约束', genericEntity);
    }
  }

  if (entities.length > 0) {
    return {
      value: entities.join(' / '),
      state: 'confirmed',
    };
  }

  return {
    value: '待补充实体对象',
    state: 'missing',
    note: '尚未识别到项目、区域等明确实体。',
  };
}

function extractTimeRange(questionText: string): ExtractionResult {
  for (const rule of TIME_RANGE_RULES) {
    if (rule.pattern.test(questionText)) {
      return {
        value: rule.label,
        state: 'confirmed',
      };
    }
  }

  return {
    value: '待补充时间范围',
    state: 'missing',
    note: '建议明确时间范围，例如近三个月或本季度。',
  };
}

function extractComparison(questionText: string): ExtractionResult {
  for (const rule of COMPARISON_RULES) {
    if (rule.pattern.test(questionText)) {
      return {
        value: rule.label,
        state: 'confirmed',
      };
    }
  }

  if (/对比|比较|相比|较|趋势|波动|变化|上升|下降/.test(questionText)) {
    return {
      value: '存在趋势或比较语义',
      state: 'uncertain',
      note: '请补充比较基线，例如同比、环比或明确参考时间段。',
    };
  }

  return {
    value: '待补充比较方式',
    state: 'missing',
    note: '尚未识别到同比、环比或显式对比关系。',
  };
}

export function getContextFieldStateLabel(state: AnalysisContextFieldState) {
  switch (state) {
    case 'confirmed':
      return '已确认';
    case 'uncertain':
      return '待确认';
    case 'missing':
      return '待补充';
    default:
      return state;
  }
}

export function extractAnalysisContext(
  questionText: string,
): AnalysisContext {
  const normalizedQuestionText = normalizeQuestionText(questionText);
  const constraints: AnalysisContextConstraint[] = [];

  const targetMetric = toField(
    '目标指标',
    extractMetric(normalizedQuestionText),
  );
  const entity = toField(
    '实体对象',
    extractEntity(normalizedQuestionText, constraints),
  );
  const timeRange = toField(
    '时间范围',
    extractTimeRange(normalizedQuestionText),
  );
  const comparison = toField(
    '比较方式',
    extractComparison(normalizedQuestionText),
  );

  return {
    targetMetric,
    entity,
    timeRange,
    comparison,
    constraints,
  };
}

export function isLegacyPlaceholderAnalysisContext(
  context: AnalysisContext | undefined,
) {
  if (!context) {
    return false;
  }

  return (
    context.targetMetric.value === '待补充目标指标' &&
    context.targetMetric.state === 'missing' &&
    context.entity.value === '待补充实体对象' &&
    context.entity.state === 'missing' &&
    context.timeRange.value === '待补充时间范围' &&
    context.timeRange.state === 'missing' &&
    context.comparison.value === '待补充比较方式' &&
    context.comparison.state === 'missing' &&
    context.constraints.length === 0
  );
}

export function resolveStoredAnalysisContext(
  questionText: string,
  savedContext?: AnalysisContext,
): AnalysisContext {
  if (!savedContext || isLegacyPlaceholderAnalysisContext(savedContext)) {
    return extractAnalysisContext(questionText);
  }

  return savedContext;
}

export type ContextCorrection = {
  targetMetric?: { value: string; note?: string };
  entity?: { value: string; note?: string };
  timeRange?: { value: string; note?: string };
  comparison?: { value: string; note?: string };
};

export type VersionedAnalysisContext = {
  sessionId: string;
  ownerUserId: string;
  version: number;
  context: AnalysisContext;
  originalQuestionText: string;
  createdAt: string;
};

export function applyContextCorrection(
  context: AnalysisContext,
  correction: ContextCorrection,
): AnalysisContext {
  const corrected = { ...context };

  if (correction.targetMetric) {
    corrected.targetMetric = {
      ...context.targetMetric,
      value: correction.targetMetric.value,
      state: 'confirmed',
      note: correction.targetMetric.note,
    };
  }

  if (correction.entity) {
    corrected.entity = {
      ...context.entity,
      value: correction.entity.value,
      state: 'confirmed',
      note: correction.entity.note,
    };
  }

  if (correction.timeRange) {
    corrected.timeRange = {
      ...context.timeRange,
      value: correction.timeRange.value,
      state: 'confirmed',
      note: correction.timeRange.note,
    };
  }

  if (correction.comparison) {
    corrected.comparison = {
      ...context.comparison,
      value: correction.comparison.value,
      state: 'confirmed',
      note: correction.comparison.note,
    };
  }

  return corrected;
}

export class ContextCorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextCorrectionError';
  }
}

export function validateContextCorrection(correction: unknown): ContextCorrection {
  if (!correction || typeof correction !== 'object') {
    throw new ContextCorrectionError('修正内容必须是一个对象。');
  }

  const candidate = correction as Record<string, unknown>;
  const validFields = ['targetMetric', 'entity', 'timeRange', 'comparison'];
  const hasAtLeastOne = validFields.some(
    (field) => candidate[field] !== undefined,
  );

  if (!hasAtLeastOne) {
    throw new ContextCorrectionError(
      '至少需要修正一个字段（targetMetric、entity、timeRange 或 comparison）。',
    );
  }

  const result: ContextCorrection = {};

  for (const field of validFields) {
    const entry = candidate[field];

    if (entry === undefined) {
      continue;
    }

    if (!entry || typeof entry !== 'object') {
      throw new ContextCorrectionError(`字段 ${field} 必须包含 value 属性。`);
    }

    const entryObj = entry as Record<string, unknown>;

    if (typeof entryObj.value !== 'string' || !entryObj.value.trim()) {
      throw new ContextCorrectionError(`字段 ${field}.value 不能为空。`);
    }

    (result as Record<string, unknown>)[field] = {
      value: entryObj.value.trim(),
      note:
        typeof entryObj.note === 'string' ? entryObj.note.trim() : undefined,
    };
  }

  return result;
}
