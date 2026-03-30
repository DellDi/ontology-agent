import type {
  LlmResponseFormatConfig,
  LlmResponseRequest,
} from '@/application/llm/models';
import type { AnalysisAiTaskType } from '@/domain/analysis-ai/models';
import { z } from 'zod';
import {
  analysisContextInputSchema,
  analysisContextOutputSchema,
  analysisIntentInputSchema,
  analysisIntentOutputSchema,
  analysisPlanInputSchema,
  analysisPlanOutputSchema,
  conclusionSummaryInputSchema,
  conclusionSummaryOutputSchema,
  toolSelectionInputSchema,
  toolSelectionOutputSchema,
  type AnalysisContextInput,
  type AnalysisIntentInput,
  type AnalysisPlanInput,
  type ConclusionSummaryInput,
  type ToolSelectionInput,
} from '@/domain/analysis-ai/contracts';

type PromptBuilder<TInput> = (input: TInput) => LlmResponseRequest;

type PromptDefinition<TInput> = {
  inputSchema: { parse: (value: unknown) => TInput };
  buildRequest: PromptBuilder<TInput>;
};

function buildResponseFormat(
  name: string,
  description: string,
  schema: Record<string, unknown>,
): LlmResponseFormatConfig {
  return {
    type: 'json_schema',
    name,
    description,
    schema,
    strict: true,
  };
}

function buildStructuredPrompt(taskName: string, input: Record<string, unknown>) {
  return JSON.stringify(
    {
      task: taskName,
      requirements: [
        '只返回一个 JSON 对象，不要输出 markdown。',
        '字段必须完整，不能省略 schema 中的必填字段。',
        '无法确定时请返回保守值，不要编造超出输入的信息。',
      ],
      input,
    },
    null,
    2,
  );
}

const promptDefinitions: Record<AnalysisAiTaskType, PromptDefinition<unknown>> = {
  'analysis-intent': {
    inputSchema: analysisIntentInputSchema,
    buildRequest(input) {
      const typedInput = input as AnalysisIntentInput;
      return {
        systemPrompt:
          '你是物业数据分析系统的意图识别模块。请把用户问题映射为受控 JSON 输出。',
        input: buildStructuredPrompt('analysis-intent', typedInput),
        responseFormat: buildResponseFormat(
          'analysis_intent',
          '物业分析问题的结构化意图识别结果。',
          z.toJSONSchema(analysisIntentOutputSchema),
        ),
      };
    },
  },
  'analysis-context': {
    inputSchema: analysisContextInputSchema,
    buildRequest(input) {
      const typedInput = input as AnalysisContextInput;
      return {
        systemPrompt:
          '你是物业数据分析系统的上下文抽取模块。请输出字段化上下文，不要输出自然语言解释。',
        input: buildStructuredPrompt('analysis-context', typedInput),
        responseFormat: buildResponseFormat(
          'analysis_context',
          '物业分析问题的结构化上下文抽取结果。',
          z.toJSONSchema(analysisContextOutputSchema),
        ),
      };
    },
  },
  'analysis-plan': {
    inputSchema: analysisPlanInputSchema,
    buildRequest(input) {
      const typedInput = input as AnalysisPlanInput;
      return {
        systemPrompt:
          '你是物业分析编排规划模块。请生成可执行的结构化计划骨架。',
        input: buildStructuredPrompt('analysis-plan', typedInput),
        responseFormat: buildResponseFormat(
          'analysis_plan',
          '物业分析编排计划的结构化输出。',
          z.toJSONSchema(analysisPlanOutputSchema),
        ),
      };
    },
  },
  'tool-selection': {
    inputSchema: toolSelectionInputSchema,
    buildRequest(input) {
      const typedInput = input as ToolSelectionInput;
      return {
        systemPrompt:
          '你是物业分析工具选择模块。请只输出工具决策 JSON，不要解释过程。',
        input: buildStructuredPrompt('tool-selection', typedInput),
        responseFormat: buildResponseFormat(
          'tool_selection',
          '物业分析工具选择结果的结构化输出。',
          z.toJSONSchema(toolSelectionOutputSchema),
        ),
      };
    },
  },
  'conclusion-summary': {
    inputSchema: conclusionSummaryInputSchema,
    buildRequest(input) {
      const typedInput = input as ConclusionSummaryInput;
      return {
        systemPrompt:
          '你是物业分析结果总结模块。请输出保守、可解释的结论摘要 JSON。',
        input: buildStructuredPrompt('conclusion-summary', typedInput),
        responseFormat: buildResponseFormat(
          'conclusion_summary',
          '物业分析结论摘要的结构化输出。',
          z.toJSONSchema(conclusionSummaryOutputSchema),
        ),
      };
    },
  },
};

export function getPromptDefinition(taskType: AnalysisAiTaskType) {
  return promptDefinitions[taskType];
}

export function buildStructuredTaskRequest(
  taskType: AnalysisAiTaskType,
  input: unknown,
): LlmResponseRequest {
  const definition = getPromptDefinition(taskType);
  const validatedInput = definition.inputSchema.parse(input);
  return definition.buildRequest(validatedInput);
}

export const STRUCTURED_PROMPT_TASK_TYPES = Object.freeze(
  Object.keys(promptDefinitions) as AnalysisAiTaskType[],
);
