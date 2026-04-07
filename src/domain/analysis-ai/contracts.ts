import { z } from 'zod';

import { ANALYSIS_INTENT_TYPES } from '@/domain/analysis-intent/models';

const analysisContextFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  state: z.enum(['missing', 'uncertain', 'confirmed']),
  note: z.string().optional(),
});

const analysisContextConstraintSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

const analysisPlanStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1),
  objective: z.string().min(1),
  dependencyIds: z.array(z.string()),
});

const toolDecisionSchema = z.object({
  toolName: z.string().min(1),
  objective: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const conclusionEvidenceSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
});

export const analysisIntentInputSchema = z.object({
  questionText: z.string().min(1),
});

export const analysisIntentOutputSchema = z.object({
  type: z.enum(ANALYSIS_INTENT_TYPES),
  goal: z.string().min(1),
});

export const analysisContextInputSchema = z.object({
  questionText: z.string().min(1),
});

export const analysisContextOutputSchema = z.object({
  targetMetric: analysisContextFieldSchema,
  entity: analysisContextFieldSchema,
  timeRange: analysisContextFieldSchema,
  comparison: analysisContextFieldSchema,
  constraints: z.array(analysisContextConstraintSchema),
});

export const analysisPlanInputSchema = z.object({
  questionText: z.string().min(1),
  contextSummary: z.string().min(1).optional(),
});

export const analysisPlanOutputSchema = z.object({
  mode: z.enum(['minimal', 'multi-step']),
  summary: z.string().min(1),
  steps: z.array(analysisPlanStepSchema),
});

export const toolSelectionInputSchema = z.object({
  questionText: z.string().min(1),
  planSummary: z.string().min(1).optional(),
  stepId: z.string().min(1),
  stepTitle: z.string().min(1).optional(),
  stepObjective: z.string().min(1).optional(),
});

export const toolSelectionOutputSchema = z.object({
  strategy: z.string().min(1),
  tools: z.array(toolDecisionSchema),
});

export const conclusionSummaryInputSchema = z.object({
  questionText: z.string().min(1),
  evidenceSummary: z.string().min(1).optional(),
});

export const conclusionSummaryOutputSchema = z.object({
  summary: z.string().min(1),
  conclusion: z.string().min(1),
  evidence: z.array(conclusionEvidenceSchema),
  confidence: z.number().min(0).max(1),
});

export type AnalysisIntentInput = z.infer<typeof analysisIntentInputSchema>;
export type AnalysisIntentOutput = z.infer<typeof analysisIntentOutputSchema>;
export type AnalysisContextInput = z.infer<typeof analysisContextInputSchema>;
export type AnalysisContextOutput = z.infer<typeof analysisContextOutputSchema>;
export type AnalysisPlanInput = z.infer<typeof analysisPlanInputSchema>;
export type AnalysisPlanOutput = z.infer<typeof analysisPlanOutputSchema>;
export type ToolSelectionInput = z.infer<typeof toolSelectionInputSchema>;
export type ToolSelectionOutput = z.infer<typeof toolSelectionOutputSchema>;
export type ConclusionSummaryInput = z.infer<typeof conclusionSummaryInputSchema>;
export type ConclusionSummaryOutput = z.infer<typeof conclusionSummaryOutputSchema>;

export function buildAnalysisIntentFallback(): AnalysisIntentOutput {
  return {
    type: 'general-analysis',
    goal: '综合物业数据分析：待补充明确分析目标。',
  };
}

export function buildAnalysisContextFallback(): AnalysisContextOutput {
  return {
    targetMetric: {
      label: '目标指标',
      value: '待补充目标指标',
      state: 'missing',
      note: '结构化抽取失败，建议补充具体指标口径。',
    },
    entity: {
      label: '实体对象',
      value: '待补充实体对象',
      state: 'missing',
      note: '结构化抽取失败，建议补充项目或区域范围。',
    },
    timeRange: {
      label: '时间范围',
      value: '待补充时间范围',
      state: 'missing',
      note: '结构化抽取失败，建议补充时间范围。',
    },
    comparison: {
      label: '比较方式',
      value: '待补充比较方式',
      state: 'missing',
      note: '结构化抽取失败，建议补充同比或环比基线。',
    },
    constraints: [],
  };
}

export function buildAnalysisPlanFallback(): AnalysisPlanOutput {
  return {
    mode: 'minimal',
    summary: '结构化计划生成失败，先返回极简计划并等待用户确认口径。',
    steps: [
      {
        id: 'confirm-query-scope',
        order: 1,
        title: '确认查询口径',
        objective: '确认指标、实体和时间范围，避免带着错误上下文继续执行。',
        dependencyIds: [],
      },
    ],
  };
}

export function buildToolSelectionFallback(): ToolSelectionOutput {
  return {
    strategy: '结构化工具决策失败，暂不自动调用外部工具。',
    tools: [],
  };
}

export function buildConclusionSummaryFallback(): ConclusionSummaryOutput {
  return {
    summary: '结构化归纳失败，暂不输出最终结论。',
    conclusion: '需要更多证据后再给出归因判断。',
    evidence: [],
    confidence: 0,
  };
}
