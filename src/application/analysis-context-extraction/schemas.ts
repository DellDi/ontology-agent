import { z } from 'zod';

/**
 * LLM 语义抽取的输出 schema — 固定结构，Zod 强校验。
 * 字段置信度范围 [0, 1]，用于驱动自动猜测策略。
 */
export const llmContextExtractionOutputSchema = z.object({
  targetMetric: z.object({
    value: z.string(),
    confidence: z.number().min(0).max(1),
    candidates: z.array(z.string()).optional(),
  }),
  entity: z.object({
    value: z.string(),
    kind: z.enum(['project', 'area', 'community', 'unknown']),
    confidence: z.number().min(0).max(1),
    candidates: z.array(z.string()).optional(),
  }),
  timeRange: z.object({
    value: z.string(),
    normalized: z.string().optional(),
    confidence: z.number().min(0).max(1),
  }),
  comparison: z.object({
    value: z.string(),
    type: z.enum(['yoy', 'mom', 'custom', 'none']),
    confidence: z.number().min(0).max(1),
  }),
  filters: z
    .array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
  assumptions: z.array(z.string()),
  needsClarification: z.boolean(),
  overallConfidence: z.number().min(0).max(1),
});

export type LlmContextExtractionOutput = z.infer<
  typeof llmContextExtractionOutputSchema
>;

/**
 * LLM 语义抽取的输入 schema — 描述用户问题及辅助字典。
 */
export const llmContextExtractionInputSchema = z.object({
  questionText: z.string().min(1),
  projectNames: z.array(z.string()).optional(),
  metricDictionary: z.array(z.string()).optional(),
  ontologyVersionSummary: z.string().optional(),
});

export type LlmContextExtractionInput = z.infer<
  typeof llmContextExtractionInputSchema
>;
