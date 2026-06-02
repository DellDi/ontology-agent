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

/**
 * Story 12 fix: 工具执行事件发射器接口
 * 用于在工具调用过程中实时发布事件，而不是事后回放。
 * 这个接口定义在 application 层，具体实现由 worker 层注入。
 */
export type ToolExecutionEventEmitter = {
  onToolStarted: (input: {
    toolName: AnalysisToolName;
    toolLabel: string;
    startedAt: number;
  }) => Promise<void>;
  onToolCompleted: (input: {
    toolName: AnalysisToolName;
    toolLabel: string;
    startedAt: number;
    finishedAt: number;
    output?: unknown;
  }) => Promise<void>;
  onToolFailed: (input: {
    toolName: AnalysisToolName;
    toolLabel: string;
    startedAt: number;
    finishedAt: number;
    error: string;
  }) => Promise<void>;
};

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
      signal,
    }: {
      stepId: string;
      stepTitle?: string;
      stepObjective?: string;
      questionText: string;
      planSummary?: string;
      context: AnalysisAiTaskContext;
      groundedContext?: OntologyGroundedContext;
      intentType?: AnalysisIntentType;
      /** 超时取消信号 — 透传到 LLM 工具选择调用。 */
      signal?: AbortSignal;
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
        availableToolNames: [...readyToolNames],
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
          // 将 signal 注入 LLM 选择调用的上下文，使超时取消可传递到底层 HTTP 客户端
          const contextWithSignal = signal
            ? { ...context, signal }
            : context;
          return await analysisAiUseCases.runTask({
            taskType: 'tool-selection',
            input: {
              questionText,
              planSummary,
              stepId,
              stepTitle,
              stepObjective,
            },
            context: contextWithSignal,
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
      eventEmitter,
      signal,
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
      eventEmitter?: ToolExecutionEventEmitter;
      /** 超时取消信号 — 透传到工具调用上下文，以便底层中止 HTTP 请求。 */
      signal?: AbortSignal;
    }): Promise<OrchestrationStepExecutionResult> {
      // 将 signal 合并到 invocationContext，使工具层可通过 context.signal 获取
      const effectiveInvocationContext: AnalysisToolInvocationContext = signal
        ? { ...invocationContext, signal }
        : invocationContext;
      const selection = await this.selectToolsForStep({
        stepId,
        stepTitle,
        stepObjective,
        questionText,
        planSummary,
        context: selectionContext,
        groundedContext,
        intentType,
        signal,
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
        // 超时防护：若 signal 已 abort，跳过后续工具调用与事件发布
        if (signal?.aborted) {
          break;
        }

        // Story 12 fix: 在工具调用前发布 started 事件
        // 事件发布是可观测链路，失败时记录诊断但不阻断工具执行（主链路）
        const startedAt = Date.now();
        if (eventEmitter && !signal?.aborted) {
          try {
            await eventEmitter.onToolStarted({
              toolName: tool.toolName,
              toolLabel: tool.objective,
              startedAt,
            });
          } catch (emitError) {
            console.error(
              `[diagnostic] eventEmitter.onToolStarted failed`,
              {
                toolName: tool.toolName,
                correlationId: invocationContext.correlationId,
                error: emitError instanceof Error ? emitError.message : String(emitError),
              },
            );
          }
        }

        const event = await toolRegistryUseCases.invokeTool({
          toolName: tool.toolName,
          input:
            tool.toolName === 'llm.structured-analysis'
              ? buildConclusionSummaryToolInput(
                  toolInputsByName[tool.toolName],
                  events,
                )
              : toolInputsByName[tool.toolName],
          context: effectiveInvocationContext,
        });

        const finishedAt = Date.now();

        // Story 12 fix: 在工具调用后发布 completed/failed 事件
        // 超时防护：signal.aborted 时丢弃事件，避免 late events
        if (eventEmitter && !signal?.aborted) {
          try {
            if (event.ok) {
              await eventEmitter.onToolCompleted({
                toolName: tool.toolName,
                toolLabel: tool.objective,
                startedAt,
                finishedAt,
                output: event.output,
              });
            } else if (event.error.code !== 'tool-empty-result') {
              await eventEmitter.onToolFailed({
                toolName: tool.toolName,
                toolLabel: tool.objective,
                startedAt,
                finishedAt,
                error: event.error.message,
              });
            }
          } catch (emitError) {
            console.error(
              `[diagnostic] eventEmitter.onTool${event.ok ? 'Completed' : 'Failed'} failed`,
              {
                toolName: tool.toolName,
                correlationId: invocationContext.correlationId,
                error: emitError instanceof Error ? emitError.message : String(emitError),
              },
            );
          }
        }

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
