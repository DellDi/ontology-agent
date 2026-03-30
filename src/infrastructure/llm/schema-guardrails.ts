import { ZodError, type ZodType } from 'zod';

import {
  ANALYSIS_AI_TASK_TYPES,
  type AnalysisAiTaskType,
  type StructuredTaskParseResult,
} from '@/domain/analysis-ai/models';
import {
  analysisContextOutputSchema,
  analysisIntentOutputSchema,
  analysisPlanOutputSchema,
  buildAnalysisContextFallback,
  buildAnalysisIntentFallback,
  buildAnalysisPlanFallback,
  buildConclusionSummaryFallback,
  buildToolSelectionFallback,
  conclusionSummaryOutputSchema,
  toolSelectionOutputSchema,
} from '@/domain/analysis-ai/contracts';

type GuardrailContract = {
  outputSchema: ZodType;
  buildFallback: () => unknown;
};

const guardrailContracts: Record<AnalysisAiTaskType, GuardrailContract> = {
  'analysis-intent': {
    outputSchema: analysisIntentOutputSchema,
    buildFallback: buildAnalysisIntentFallback,
  },
  'analysis-context': {
    outputSchema: analysisContextOutputSchema,
    buildFallback: buildAnalysisContextFallback,
  },
  'analysis-plan': {
    outputSchema: analysisPlanOutputSchema,
    buildFallback: buildAnalysisPlanFallback,
  },
  'tool-selection': {
    outputSchema: toolSelectionOutputSchema,
    buildFallback: buildToolSelectionFallback,
  },
  'conclusion-summary': {
    outputSchema: conclusionSummaryOutputSchema,
    buildFallback: buildConclusionSummaryFallback,
  },
};

function toIssues(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.join('.') || '$',
      message: issue.message,
    }));
  }

  if (error instanceof Error) {
    return [
      {
        path: '$',
        message: error.message,
      },
    ];
  }

  return [
    {
      path: '$',
      message: '未知结构化输出错误。',
    },
  ];
}

function parseRawText(rawText: string) {
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new Error('模型未返回结构化输出内容。');
  }

  return JSON.parse(trimmed) as unknown;
}

export function isStructuredTaskType(value: string): value is AnalysisAiTaskType {
  return ANALYSIS_AI_TASK_TYPES.includes(value as AnalysisAiTaskType);
}

export function parseStructuredTaskOutput<TTaskType extends AnalysisAiTaskType>(
  input: {
    taskType: TTaskType;
    rawText: string;
    raw: Record<string, unknown>;
  },
) : StructuredTaskParseResult<TTaskType> {
  const contract = guardrailContracts[input.taskType];

  try {
    const parsedJson = parseRawText(input.rawText);
    const parsedResult = contract.outputSchema.safeParse(parsedJson);

    if (parsedResult.success) {
      return {
        taskType: input.taskType,
        ok: true,
        value: parsedResult.data,
        rawText: input.rawText,
        raw: input.raw,
        issues: [],
      };
    }

    return {
      taskType: input.taskType,
      ok: false,
      value: contract.buildFallback(),
      rawText: input.rawText,
      raw: input.raw,
      issues: toIssues(parsedResult.error),
    };
  } catch (error) {
    return {
      taskType: input.taskType,
      ok: false,
      value: contract.buildFallback(),
      rawText: input.rawText,
      raw: input.raw,
      issues: toIssues(error),
    };
  }
}
