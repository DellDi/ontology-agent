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

如果输入提供了 knownMetrics 或 availableProjects，请优先在这些列表中匹配。无法匹配时降低对应字段的 confidence。`;

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

      const validation =
        llmContextExtractionOutputSchema.safeParse(parsed);
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
