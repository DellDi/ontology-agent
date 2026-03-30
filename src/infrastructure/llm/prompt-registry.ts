import type { LlmResponseRequest } from '@/application/llm/models';
import type { AnalysisAiTaskType } from '@/domain/analysis-ai/models';
import {
  analysisContextInputSchema,
  analysisIntentInputSchema,
  analysisPlanInputSchema,
  conclusionSummaryInputSchema,
  toolSelectionInputSchema,
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
