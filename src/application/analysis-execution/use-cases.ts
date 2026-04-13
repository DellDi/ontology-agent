import type { AnalysisAiTaskContext } from '@/domain/analysis-ai/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';
import type {
  AnalysisToolInvocationContext,
  AnalysisToolInvocationResult,
  AnalysisToolName,
  OrchestrationStepExecutionResult,
  OrchestrationStepSelection,
  ToolSelectionDecision,
} from '@/domain/tooling/models';
import { summarizeToolEvent } from '@/shared/tooling/tool-event-presentation';

type ToolRegistryUseCases = {
  listToolDefinitions: () => {
    name: AnalysisToolName;
    availability?: 'ready' | 'degraded';
  }[];
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
  ontologyToolBindingUseCases?: {
    selectToolsForStep: (input: {
      stepId: string;
      availableToolNames: AnalysisToolName[];
      groundedContext?: OntologyGroundedContext;
      intentType?: AnalysisIntentType;
      questionText?: string;
      stepTitle?: string;
      stepObjective?: string;
    }) => Promise<OrchestrationStepSelection | null>;
  };
};

const STEP_TOOL_FALLBACKS: Record<string, AnalysisToolName[]> = {
  'confirm-analysis-scope': ['platform.capability-status'],
  'confirm-query-scope': ['platform.capability-status'],
  'inspect-metric-change': ['cube.semantic-query', 'platform.capability-status'],
  'validate-candidate-factors': [
    'neo4j.graph-query',
    'erp.read-model',
    'platform.capability-status',
  ],
  'synthesize-attribution': [
    'cube.semantic-query',
    'neo4j.graph-query',
    'erp.read-model',
    'llm.structured-analysis',
    'platform.capability-status',
  ],
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
  registeredToolNames: Set<AnalysisToolName>,
): ToolSelectionDecision[] {
  return (STEP_TOOL_FALLBACKS[stepId] ?? [])
    .filter(
      (toolName) =>
        availableToolNames.has(toolName) ||
        (toolName === 'platform.capability-status' &&
          registeredToolNames.has(toolName)),
    )
    .map((toolName) => ({
      toolName,
      objective: availableToolNames.has(toolName)
        ? '基于步骤语义的保守工具回退选择。'
        : '在无 ready 工具时回退到平台能力检查，显式说明降级原因。',
      confidence: availableToolNames.has(toolName) ? 0.5 : 0.3,
    }));
}

function buildConclusionSummaryToolInput(
  input: unknown,
  events: AnalysisToolInvocationResult[],
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const candidate = input as {
    taskType?: string;
    input?: {
      questionText?: string;
      evidenceSummary?: string;
    };
  };

  if (
    candidate.taskType !== 'conclusion-summary' ||
    !candidate.input ||
    typeof candidate.input !== 'object'
  ) {
    return input;
  }

  const evidenceSummary = [
    candidate.input.evidenceSummary?.trim() || null,
    ...events.map(summarizeToolEvent),
  ]
    .filter((value): value is string => Boolean(value))
    .slice(0, 6)
    .join('\n')
    .slice(0, 2_000);

  return {
    ...candidate,
    input: {
      ...candidate.input,
      evidenceSummary,
    },
  };
}

export function createAnalysisExecutionUseCases({
  toolRegistryUseCases,
  analysisAiUseCases,
  ontologyToolBindingUseCases,
}: AnalysisExecutionDependencies) {
  return {
    async selectToolsForStep({
      stepId,
      stepTitle,
      stepObjective,
      questionText,
      planSummary,
      context,
      groundedContext,
      intentType,
    }: {
      stepId: string;
      stepTitle?: string;
      stepObjective?: string;
      questionText: string;
      planSummary?: string;
      context: AnalysisAiTaskContext;
      groundedContext?: OntologyGroundedContext;
      intentType?: AnalysisIntentType;
    }): Promise<OrchestrationStepSelection> {
      const toolDefinitions = toolRegistryUseCases.listToolDefinitions();
      const readyToolNames = new Set(
        toolDefinitions
          .filter((tool) => tool.availability === 'ready')
          .map((tool) => tool.name),
      );
      const registeredToolNames = new Set(
        toolDefinitions.map((tool) => tool.name),
      );

      const ontologySelection = await ontologyToolBindingUseCases?.selectToolsForStep({
        stepId,
        availableToolNames: [...registeredToolNames],
        groundedContext,
        intentType,
        questionText,
        stepTitle,
        stepObjective,
      });

      if (ontologySelection && ontologySelection.tools.length > 0) {
        return ontologySelection;
      }

      const toolSelection = await (async () => {
        try {
          return await analysisAiUseCases.runTask({
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
        } catch {
          return {
            ok: false,
            value: {
              strategy: '',
              tools: [],
            },
          };
        }
      })();

      const normalizedTools = toolSelection.ok
        ? normalizeSelection(toolSelection.value.tools, readyToolNames)
        : [];

      if (normalizedTools.length > 0) {
        return {
          strategy:
            toolSelection.value.strategy?.trim() || '结构化工具选择结果',
          tools: normalizedTools,
        };
      }

      const fallbackTools = buildFallbackSelection(
        stepId,
        readyToolNames,
        registeredToolNames,
      );

      return {
        strategy: ontologySelection
          ? 'ontology binding 未命中可用工具，temporary mitigation: 回退到既有步骤级选择路径。'
          : fallbackTools.some(
                (tool) =>
                  tool.toolName === 'platform.capability-status' &&
                  !readyToolNames.has(tool.toolName),
              )
            ? '结构化工具选择未命中，回退到平台能力检查降级路径。'
            : '结构化工具选择未命中，回退到步骤级保守映射。',
        tools: fallbackTools,
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
      groundedContext,
      intentType,
    }: {
      stepId: string;
      stepTitle?: string;
      stepObjective?: string;
      questionText: string;
      planSummary?: string;
      selectionContext: AnalysisAiTaskContext;
      invocationContext: AnalysisToolInvocationContext;
      toolInputsByName: Partial<Record<AnalysisToolName, unknown>>;
      groundedContext?: OntologyGroundedContext;
      intentType?: AnalysisIntentType;
    }): Promise<OrchestrationStepExecutionResult> {
      const selection = await this.selectToolsForStep({
        stepId,
        stepTitle,
        stepObjective,
        questionText,
        planSummary,
        context: selectionContext,
        groundedContext,
        intentType,
      });

      const events: AnalysisToolInvocationResult[] = [];

      if (selection.tools.length === 0) {
        return {
          status: 'failed',
          strategy: selection.strategy,
          tools: selection.tools,
          events,
          error: {
            code: 'tool-unavailable',
            message: `步骤 ${stepId} 未匹配到可执行工具，且没有可用降级路径。`,
            toolName: 'platform.capability-status',
            correlationId: invocationContext.correlationId,
            retryable: false,
          },
        };
      }

      for (const tool of selection.tools) {
        const event = await toolRegistryUseCases.invokeTool({
          toolName: tool.toolName,
          input:
            tool.toolName === 'llm.structured-analysis'
              ? buildConclusionSummaryToolInput(
                  toolInputsByName[tool.toolName],
                  events,
                )
              : toolInputsByName[tool.toolName],
          context: invocationContext,
        });

        events.push(event);

        if (!event.ok) {
          if (event.error.code === 'tool-empty-result') {
            continue;
          }

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
