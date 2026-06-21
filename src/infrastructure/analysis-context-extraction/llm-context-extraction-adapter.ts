import { z } from 'zod';

import {
  llmContextExtractionInputSchema,
  llmContextExtractionOutputSchema,
  type LlmContextExtractionInput,
  type LlmContextExtractionOutput,
} from '@/application/analysis-context-extraction/schemas';
import type { ContextExtractionPort } from '@/application/analysis-context-extraction/ports';
import type { LlmProviderPort } from '@/application/llm/ports';

type AdapterDependencies = {
  llmProvider: LlmProviderPort;
  userId?: string;
  organizationId?: string;
  purpose?: string;
};

type JsonRecord = Record<string, unknown>;

const EXTRACTION_SYSTEM_PROMPT = `你是一个物业数据分析系统的结构化语义抽取模块。

你的任务是从用户提出的分析问题中抽取结构化上下文，输出严格符合给定 JSON Schema 的对象，不要输出任何自然语言解释或 Markdown。

需要抽取的字段：
1. targetMetric（目标指标）：收缴率、收费回款率、投诉量、工单完工率、满意度评分等
2. entity（实体对象）：项目、区域、社区等。kind 取值为 project / area / community / unknown
3. timeRange（时间范围）：今年、去年、本月、近三个月等。normalized 字段用于标准化（例如 "本年" → "2026-01-01 to 2026-12-31"）
4. comparison（比较方式）：yoy（同比）/ mom（环比）/ custom（自定义）/ none（无需比较）
5. filters（可选）：额外筛选条件
6. assumptions：为理解问题而做出的假设（可以是空数组）
7. needsClarification：问题存在歧义或缺少关键信息时设为 true
8. overallConfidence：整体置信度 [0, 1]

常见物业分析问题示例：
- "丰和园小区项目本年的物业费收缴率是多少？"
  → targetMetric.value=收缴率, entity.value=丰和园小区项目(kind=project), timeRange.value=本年, comparison.type=none
- "近三个月A区域的投诉量同比去年如何？"
  → targetMetric.value=投诉量, entity.value=A区域(kind=area), timeRange.value=近三个月, comparison.type=yoy
- "2026年各项目的收费回款率排名？"
  → targetMetric.value=收费回款率, entity.value=各项目(kind=unknown), timeRange.value=2026年, comparison.type=none

置信度设置原则：
- 1.0：非常明确，无歧义
- 0.7–0.9：较明确，可能有轻微歧义
- 0.4–0.6：不够明确，需要猜测
- 0.1–0.3：非常模糊或缺失关键信息

业务目录核对原则：
- 如果输入提供了 knownMetrics 或 availableProjects，targetMetric.value 和 entity.value 必须优先输出列表中最接近的标准项，而不是输出用户原文片段。
- 需要处理错别字、简称、音近字、形近字、缺少后缀等情况。例如用户说“六坑铺”时，应在 availableProjects 中寻找最接近的“六铺炕...”项目。
- 不要把“帮我/查看一下/分析一下/今年/本月/项目/指标/情况/多少”等意图词、时间词、通用词纳入 entity.value。
- 如果能够唯一匹配标准项目或指标，value 使用标准项，confidence >= 0.7。
- 如果有多个合理候选，value 使用最可能候选，candidates 填入候选标准项，confidence 设为 0.4–0.69，并将 needsClarification 设为 true。
- 如果业务目录中完全无法匹配，不要编造标准项；保留用户语义摘要，降低 confidence，并在 candidates 中留空或给出有限候选。
- 时间范围必须抽取成可执行语义；用户没有时间时设为缺失/低置信度，不要默认今年，除非用户有明确相对时间表达。

程序会在模型输出后继续用 ERP 项目目录和 ontology 指标定义做核验。你的职责是语义理解和结构化候选，不要输出自然语言解释。`;

function buildUserPrompt(input: LlmContextExtractionInput): string {
  return JSON.stringify(
    {
      questionText: input.questionText,
      ...(input.projectNames
        ? { availableProjects: input.projectNames }
        : {}),
      ...(input.metricDictionary
        ? { knownMetrics: input.metricDictionary }
        : {}),
      ...(input.ontologyVersionSummary
        ? { ontologySummary: input.ontologyVersionSummary }
        : {}),
    },
    null,
    2,
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObjectField(record: JsonRecord, key: string): JsonRecord {
  const value = record[key];

  return isRecord(value) ? value : {};
}

function readStringField(record: JsonRecord, key: string, fallback = '') {
  const value = record[key];

  return typeof value === 'string' ? value.trim() : fallback;
}

function readConfidence(record: JsonRecord, key: string, fallback: number) {
  const value = record[key];
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, numericValue));
}

function readStringArray(record: JsonRecord, key: string) {
  const value = record[key];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return strings.length > 0 ? strings : undefined;
}

function readEntityKind(value: unknown) {
  return value === 'project' ||
    value === 'area' ||
    value === 'community' ||
    value === 'unknown'
    ? value
    : 'unknown';
}

function readComparisonType(value: unknown) {
  return value === 'yoy' || value === 'mom' || value === 'custom' || value === 'none'
    ? value
    : 'none';
}

function readGranularityValue(value: unknown) {
  return value === 'day' ||
    value === 'week' ||
    value === 'month' ||
    value === 'quarter' ||
    value === 'year'
    ? value
    : undefined;
}

function readFilters(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filters = value
    .filter(isRecord)
    .map((filter) => ({
      field: readStringField(filter, 'field'),
      operator: readStringField(filter, 'operator', 'eq'),
      value: readStringField(filter, 'value'),
    }))
    .filter((filter) => filter.field && filter.value);

  return filters.length > 0 ? filters : undefined;
}

export function coerceLlmContextExtractionOutput(
  value: unknown,
): LlmContextExtractionOutput | null {
  if (!isRecord(value)) {
    return null;
  }

  const targetMetricRecord = readObjectField(value, 'targetMetric');
  const entityRecord = readObjectField(value, 'entity');
  const timeRangeRecord = readObjectField(value, 'timeRange');
  const comparisonRecord = readObjectField(value, 'comparison');

  const targetMetricValue = readStringField(targetMetricRecord, 'value');
  const entityValue = readStringField(entityRecord, 'value');
  const timeRangeValue = readStringField(timeRangeRecord, 'value');

  if (!targetMetricValue || !entityValue || !timeRangeValue) {
    return null;
  }

  const comparisonType = readComparisonType(comparisonRecord.type);
  const comparisonValue =
    readStringField(comparisonRecord, 'value') ||
    (comparisonType === 'none' ? '无需比较' : comparisonType);
  const targetMetricConfidence = readConfidence(
    targetMetricRecord,
    'confidence',
    0.65,
  );
  const entityConfidence = readConfidence(entityRecord, 'confidence', 0.65);
  const timeRangeConfidence = readConfidence(
    timeRangeRecord,
    'confidence',
    0.65,
  );
  const comparisonConfidence = readConfidence(
    comparisonRecord,
    'confidence',
    comparisonType === 'none' ? 0.7 : 0.55,
  );
  const granularityRecord = readObjectField(value, 'granularity');
  const granularityValue = readGranularityValue(granularityRecord.value);
  const filters = readFilters(value.filters);
  const assumptions = Array.isArray(value.assumptions)
    ? value.assumptions.filter(
        (assumption): assumption is string =>
          typeof assumption === 'string' && assumption.trim().length > 0,
      )
    : [];
  const overallConfidence = readConfidence(
    value,
    'overallConfidence',
    Math.min(
      targetMetricConfidence,
      entityConfidence,
      timeRangeConfidence,
      comparisonConfidence,
    ),
  );

  return {
    targetMetric: {
      value: targetMetricValue,
      confidence: targetMetricConfidence,
      candidates: readStringArray(targetMetricRecord, 'candidates'),
    },
    entity: {
      value: entityValue,
      kind: readEntityKind(entityRecord.kind),
      confidence: entityConfidence,
      candidates: readStringArray(entityRecord, 'candidates'),
    },
    timeRange: {
      value: timeRangeValue,
      normalized: readStringField(timeRangeRecord, 'normalized') || undefined,
      confidence: timeRangeConfidence,
    },
    comparison: {
      value: comparisonValue,
      type: comparisonType,
      confidence: comparisonConfidence,
    },
    granularity: granularityValue
      ? {
          value: granularityValue,
          confidence: readConfidence(granularityRecord, 'confidence', 0.6),
        }
      : undefined,
    filters,
    assumptions,
    needsClarification:
      typeof value.needsClarification === 'boolean'
        ? value.needsClarification
        : overallConfidence < 0.7,
    overallConfidence,
  };
}

export function createLlmContextExtractionAdapter({
  llmProvider,
  userId = 'analysis-context-extraction',
  organizationId = 'analysis-context-extraction',
  purpose = 'analysis-context-extraction',
}: AdapterDependencies): ContextExtractionPort {
  const responseSchema = z.toJSONSchema(llmContextExtractionOutputSchema);

  return {
    async extract(
      input: LlmContextExtractionInput,
    ): Promise<LlmContextExtractionOutput> {
      const validatedInput =
        llmContextExtractionInputSchema.parse(input);

      const result = await llmProvider.createResponse(
        {
          input: buildUserPrompt(validatedInput),
          systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          responseFormat: {
            type: 'json_schema',
            name: 'llm_context_extraction',
            description: '物业分析问题的结构化语义抽取结果。',
            schema: responseSchema,
            strict: true,
          },
        },
        { userId, organizationId, purpose },
      );

      const trimmed = result.text.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        throw new Error(
          `LLM 抽取结果不是有效 JSON：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }

      let validation =
        llmContextExtractionOutputSchema.safeParse(parsed);
      if (!validation.success) {
        const repaired = coerceLlmContextExtractionOutput(parsed);
        if (repaired) {
          validation = llmContextExtractionOutputSchema.safeParse(repaired);
          if (validation.success) {
            console.warn(
              'LLM 抽取结果缺少部分契约字段，已按 schema 补齐后继续。',
            );
          }
        }
      }
      if (!validation.success) {
        const issueMessages = validation.error.issues
          .map(
            (issue) =>
              `${issue.path.join('.') || '$'}: ${issue.message}`,
          )
          .join('；');
        throw new Error(
          `LLM 抽取结果未通过 schema 校验：${issueMessages}`,
        );
      }

      return validation.data;
    },
  };
}
