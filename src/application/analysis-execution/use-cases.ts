import type { AnalysisAiTaskContext } from '@/domain/analysis-ai/models';
import type {
  AnalysisToolInvocationContext,
  AnalysisToolInvocationResult,
  AnalysisToolName,
  OrchestrationStepExecutionResult,
  OrchestrationStepSelection,
  ToolSelectionDecision,
} from '@/domain/tooling/models';

type ToolRegistryUseCases = {
  listToolDefinitions: () => { name: AnalysisToolName }[];
  invokeTool: (input: {
    toolName: AnalysisToolName;
    input: unknown;
    context: AnalysisToolInvocationContext;
  }) => Promise<AnalysisToolInvocationResult>;
};

type ToolSelectionAiUseCases = {
  runTask: (request: {
    taskType: 'tool-selection';
    input: {
      questionText: string;
      planSummary?: string;
      stepId: string;
      stepTitle?: string;
      stepObjective?: string;
    };
    context: AnalysisAiTaskContext;
  }) => Promise<{
    ok: boolean;
    value: {
      strategy?: string;
      tools?: { toolName: string; objective: string; confidence: number }[];
    };
  }>;
};

type AnalysisExecutionDependencies = {
  toolRegistryUseCases: ToolRegistryUseCases;
  analysisAiUseCases: ToolSelectionAiUseCases;
};

const STEP_TOOL_FALLBACKS: Record<string, AnalysisToolName[]> = {
  'confirm-analysis-scope': ['llm.structured-analysis'],
  'confirm-query-scope': ['llm.structured-analysis'],
  'inspect-metric-change': ['cube.semantic-query'],
  'validate-candidate-factors': ['neo4j.graph-query', 'erp.read-model'],
  'synthesize-attribution': ['llm.structured-analysis'],
};

const TOOL_NAME_ALIASES: Record<string, AnalysisToolName> = {
  llm: 'llm.structured-analysis',
  'llm.structured-analysis': 'llm.structured-analysis',
  erp: 'erp.read-model',
  'erp.read-model': 'erp.read-model',
  cube: 'cube.semantic-query',
  'cube.semantic-query': 'cube.semantic-query',
  neo4j: 'neo4j.graph-query',
  graph: 'neo4j.graph-query',
  'neo4j.graph-query': 'neo4j.graph-query',
};

function normalizeSelection(
  decisions: { toolName: string; objective: string; confidence: number }[] | undefined,
  availableToolNames: Set<AnalysisToolName>,
): ToolSelectionDecision[] {
  return (decisions ?? [])
    .map((decision) => {
      const normalizedName = TOOL_NAME_ALIASES[decision.toolName.trim()];

      if (!normalizedName || !availableToolNames.has(normalizedName)) {
        return null;
      }

      return {
        toolName: normalizedName,
        objective: decision.objective,
        confidence: decision.confidence,
      } satisfies ToolSelectionDecision;
    })
    .filter((value): value is ToolSelectionDecision => Boolean(value));
}

function buildFallbackSelection(
  stepId: string,
  availableToolNames: Set<AnalysisToolName>,
): ToolSelectionDecision[] {
  return (STEP_TOOL_FALLBACKS[stepId] ?? [])
    .filter((toolName) => availableToolNames.has(toolName))
    .map((toolName) => ({
      toolName,
      objective: '基于步骤语义的保守工具回退选择。',
      confidence: 0.5,
    }));
}

export function createAnalysisExecutionUseCases({
  toolRegistryUseCases,
  analysisAiUseCases,
}: AnalysisExecutionDependencies) {
  return {
    async selectToolsForStep({
      stepId,
      stepTitle,
      stepObjective,
      questionText,
      planSummary,
      context,
    }: {
      stepId: string;
      stepTitle?: string;
      stepObjective?: string;
      questionText: string;
      planSummary?: string;
      context: AnalysisAiTaskContext;
    }): Promise<OrchestrationStepSelection> {
      const availableToolNames = new Set(
        toolRegistryUseCases.listToolDefinitions().map((tool) => tool.name),
      );

      const toolSelection = await analysisAiUseCases.runTask({
        taskType: 'tool-selection',
        input: {
          questionText,
          planSummary,
          stepId,
          stepTitle,
          stepObjective,
        },
        context,
      });

      const normalizedTools = toolSelection.ok
        ? normalizeSelection(toolSelection.value.tools, availableToolNames)
        : [];

      if (normalizedTools.length > 0) {
        return {
          strategy:
            toolSelection.value.strategy?.trim() || '结构化工具选择结果',
          tools: normalizedTools,
        };
      }

      return {
        strategy: '结构化工具选择未命中，回退到步骤级保守映射。',
        tools: buildFallbackSelection(stepId, availableToolNames),
      };
    },

    async executeStep({
      stepId,
      stepTitle,
      stepObjective,
      questionText,
      planSummary,
      selectionContext,
      invocationContext,
      toolInputsByName,
    }: {
      stepId: string;
      stepTitle?: string;
      stepObjective?: string;
      questionText: string;
      planSummary?: string;
      selectionContext: AnalysisAiTaskContext;
      invocationContext: AnalysisToolInvocationContext;
      toolInputsByName: Partial<Record<AnalysisToolName, unknown>>;
    }): Promise<OrchestrationStepExecutionResult> {
      const selection = await this.selectToolsForStep({
        stepId,
        stepTitle,
        stepObjective,
        questionText,
        planSummary,
        context: selectionContext,
      });

      const events: AnalysisToolInvocationResult[] = [];

      for (const tool of selection.tools) {
        const event = await toolRegistryUseCases.invokeTool({
          toolName: tool.toolName,
          input: toolInputsByName[tool.toolName],
          context: invocationContext,
        });

        events.push(event);

        if (!event.ok) {
          return {
            status: 'failed',
            strategy: selection.strategy,
            tools: selection.tools,
            events,
            error: event.error,
          };
        }
      }

      return {
        status: 'completed',
        strategy: selection.strategy,
        tools: selection.tools,
        events,
      };
    },
  };
}
