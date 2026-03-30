import type { LlmInvocationContext, LlmTextResult } from '@/application/llm/models';

export const ANALYSIS_AI_TASK_TYPES = [
  'analysis-intent',
  'analysis-context',
  'analysis-plan',
  'tool-selection',
  'conclusion-summary',
] as const;

export type AnalysisAiTaskType = (typeof ANALYSIS_AI_TASK_TYPES)[number];

export type AnalysisAiTaskContext = LlmInvocationContext & {
  sessionId?: string;
};

export type AnalysisAiTaskRequest<
  TTaskType extends AnalysisAiTaskType = AnalysisAiTaskType,
  TInput = unknown,
> = {
  taskType: TTaskType;
  input: TInput;
  context: AnalysisAiTaskContext;
  model?: string;
};

export type StructuredGuardrailIssue = {
  path: string;
  message: string;
};

export type StructuredTaskParseResult<
  TTaskType extends AnalysisAiTaskType = AnalysisAiTaskType,
  TValue = unknown,
> = {
  taskType: TTaskType;
  ok: boolean;
  value: TValue;
  rawText: string;
  raw: Record<string, unknown>;
  issues: StructuredGuardrailIssue[];
};

export type AnalysisAiTaskResult<
  TTaskType extends AnalysisAiTaskType = AnalysisAiTaskType,
  TValue = unknown,
> = StructuredTaskParseResult<TTaskType, TValue> & {
  providerResult: LlmTextResult;
};
