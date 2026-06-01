import type {
  AnalysisContext,
  AnalysisContextConstraint,
  AnalysisContextFieldState,
} from '@/domain/analysis-context/models';

import type { LlmContextExtractionOutput } from './schemas';

/**
 * 标准化所需的上下文信息（字典、当前年份等）。
 */
export type NormalizationContext = {
  projectNames?: string[];
  metricDictionary?: string[];
  currentYear?: number;
};

export type NormalizedExtraction = {
  context: AnalysisContext;
  confidence: number;
};

/**
 * 实体 kind → 约束标签映射。
 * 小区（community）在物业领域按项目约束处理。
 */
const ENTITY_KIND_CONSTRAINT_LABEL: Record<string, string> = {
  project: '项目约束',
  area: '区域约束',
  community: '项目约束',
  unknown: '实体约束',
};

function confidenceToState(
  confidence: number,
): AnalysisContextFieldState {
  if (confidence >= 0.7) return 'confirmed';
  if (confidence >= 0.4) return 'uncertain';
  return 'missing';
}

function matchMetric(
  value: string,
  dictionary: string[] | undefined,
): { state: AnalysisContextFieldState; note?: string } {
  const trimmed = value.trim();
  if (!dictionary || dictionary.length === 0) {
    return {
      state: 'uncertain',
      note: '缺少指标字典，无法确认指标口径。',
    };
  }
  const hit = dictionary.some((entry) => {
    const e = entry.trim();
    return e === trimmed || trimmed.includes(e) || e.includes(trimmed);
  });
  if (hit) return { state: 'confirmed' };
  return {
    state: 'uncertain',
    note: `指标「${trimmed}」未在已知字典中匹配到，建议确认口径。`,
  };
}

function matchEntity(
  value: string,
  kind: string,
  projectNames: string[] | undefined,
): {
  state: AnalysisContextFieldState;
  note?: string;
  constraintLabel: string;
  normalizedValue: string;
} {
  const constraintLabel =
    ENTITY_KIND_CONSTRAINT_LABEL[kind] ?? '实体约束';
  const trimmed = value.trim();

  if (!projectNames || projectNames.length === 0) {
    if (kind === 'project' || kind === 'community') {
      return {
        state: 'uncertain',
        note: '缺少项目列表，无法确认实体是否有效。',
        constraintLabel,
        normalizedValue: trimmed,
      };
    }
    return { state: 'confirmed', constraintLabel, normalizedValue: trimmed };
  }

  const matchedName = projectNames.find((name) => {
    const n = name.trim();
    return n === trimmed || trimmed.includes(n) || n.includes(trimmed);
  });
  if (matchedName) {
    return {
      state: 'confirmed',
      constraintLabel,
      normalizedValue: matchedName.trim(),
    };
  }
  return {
    state: 'uncertain',
    note: `实体「${trimmed}」未在已知项目列表中匹配到。`,
    constraintLabel,
    normalizedValue: trimmed,
  };
}

function normalizeTimeValue(value: string, currentYear: number): string {
  const trimmed = value.trim();
  if (trimmed === '今年' || trimmed === '本年') return `${currentYear}年`;
  if (trimmed === '去年') return `${currentYear - 1}年`;
  if (trimmed === '明年') return `${currentYear + 1}年`;
  return trimmed;
}

/**
 * 将 LLM 抽取结果标准化为 AnalysisContext。
 *
 * - 指标：在字典中命中 → confirmed，否则 uncertain
 * - 实体：匹配 projectNames → confirmed，kind 映射为约束标签
 * - 时间：相对时间标准化（"本年" → "2026年"）
 * - 比较：type='none' 时统一为 "无需比较"
 * - 假设与过滤条件 → constraints 数组
 */
export function normalizeLlmExtractionOutput(
  output: LlmContextExtractionOutput,
  context: NormalizationContext = {},
): NormalizedExtraction {
  const currentYear = context.currentYear ?? new Date().getFullYear();
  const constraints: AnalysisContextConstraint[] = [];

  // 指标
  const metricMatch = matchMetric(
    output.targetMetric.value,
    context.metricDictionary,
  );
  const targetMetric = {
    label: '目标指标',
    value: output.targetMetric.value,
    state: metricMatch.state,
    note: metricMatch.note,
  };

  // 实体 — 用匹配到的项目标准名归一化，确保 Cube 按 project-name 精确过滤时命中
  const entityMatch = matchEntity(
    output.entity.value,
    output.entity.kind,
    context.projectNames,
  );
  const normalizedEntityValue = entityMatch.normalizedValue;
  const entity = {
    label: '实体对象',
    value: normalizedEntityValue,
    state: entityMatch.state,
    note: entityMatch.note,
  };
  if (normalizedEntityValue) {
    constraints.push({
      label: entityMatch.constraintLabel,
      value: normalizedEntityValue,
    });
  }

  // 时间范围 — 优先使用本模块的标准化结果（"2026年" 格式），
  // 因为执行侧 resolveDateDimension 只识别 "2026年/今年/本年/本月" 等模式，
  // 不识别 LLM 可能输出的 "2026-01-01 to 2026-12-31" 日期区间格式。
  const rawTimeValue = output.timeRange.value;
  const computedNormalized = normalizeTimeValue(rawTimeValue, currentYear);
  const llmNormalized = output.timeRange.normalized;
  const isLlmDateRange =
    llmNormalized && /\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}/.test(llmNormalized);
  const finalNormalized =
    computedNormalized !== rawTimeValue
      ? computedNormalized
      : isLlmDateRange
        ? computedNormalized
        : (llmNormalized ?? computedNormalized);
  const timeRange = {
    label: '时间范围',
    value: finalNormalized,
    state: confidenceToState(output.timeRange.confidence),
    note:
      finalNormalized !== rawTimeValue
        ? `从「${rawTimeValue}」标准化为「${finalNormalized}」`
        : undefined,
  };

  // 比较方式
  const comparisonValue =
    output.comparison.type === 'none'
      ? '无需比较'
      : output.comparison.value;
  const comparison = {
    label: '比较方式',
    value: comparisonValue,
    state: confidenceToState(output.comparison.confidence),
    note:
      output.comparison.type === 'none'
        ? '当前问题是单点指标查询，不需要比较基线。'
        : undefined,
  };

  // 时间粒度
  const granularity = output.granularity?.value
    ? {
        label: '时间粒度',
        value: output.granularity.value,
        state: confidenceToState(output.granularity.confidence),
      }
    : undefined;

  // 过滤条件 → constraints
  if (output.filters) {
    for (const filter of output.filters) {
      constraints.push({
        label: `筛选条件(${filter.field})`,
        value: `${filter.operator} ${filter.value}`,
      });
    }
  }

  // 假设 → constraints
  for (const assumption of output.assumptions) {
    constraints.push({
      label: '假设',
      value: assumption,
    });
  }

  // 整体置信度：加权字段置信度
  const confidence =
    output.targetMetric.confidence * 0.3 +
    output.entity.confidence * 0.3 +
    output.timeRange.confidence * 0.2 +
    output.comparison.confidence * 0.2;

  return {
    context: { targetMetric, entity, timeRange, comparison, granularity, constraints },
    confidence,
  };
}
