import type { ZodType } from 'zod';

import type {
  AnalysisToolDefinition,
  AnalysisToolErrorCode,
  AnalysisToolInvocationFailure,
  AnalysisToolInvocationContext,
  AnalysisToolInvocationError,
  AnalysisToolInvocationResult,
  AnalysisToolName,
} from '@/domain/tooling/models';

type ToolExecutor = {
  definition: AnalysisToolDefinition;
  inputSchema: ZodType<unknown>;
  outputSchema: ZodType<unknown>;
  resolveAvailability?: () => {
    availability: AnalysisToolDefinition['availability'];
    reason?: string;
  };
  invoke: (
    input: unknown,
    context: AnalysisToolInvocationContext,
  ) => Promise<unknown>;
  classifyEmptyOutput?: (output: unknown) => string | null;
};

type ToolRegistryDependencies = {
  tools: ToolExecutor[];
  auditRecorder?: {
    recordToolInvocation: (input: {
      userId: string;
      organizationId: string;
      sessionId?: string;
      toolName: AnalysisToolName;
      correlationId: string;
      startedAt: string;
      finishedAt: string;
      result: 'succeeded' | 'failed';
      errorCode?: AnalysisToolErrorCode;
      errorMessage?: string;
      source: 'application' | 'worker';
    }) => Promise<void>;
  };
  now?: () => string;
};

function buildFailure(params: {
  code: AnalysisToolErrorCode;
  message: string;
  toolName: AnalysisToolName;
  correlationId: string;
  retryable: boolean;
  startedAt: string;
  finishedAt: string;
}): AnalysisToolInvocationFailure {
  return {
    ok: false,
    toolName: params.toolName,
    correlationId: params.correlationId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    error: {
      code: params.code,
      message: params.message,
      toolName: params.toolName,
      correlationId: params.correlationId,
      retryable: params.retryable,
    },
  };
}

function normalizeToolError(
  error: unknown,
  toolName: AnalysisToolName,
  correlationId: string,
): AnalysisToolInvocationError {
  const message =
    error instanceof Error ? error.message : '工具调用失败。';
  const errorName = error instanceof Error ? error.name : '';

  if (/timeout/i.test(errorName) || /timeout/i.test(message)) {
    return {
      code: 'tool-timeout',
      message,
      toolName,
      correlationId,
      retryable: true,
    };
  }

  if (/permission|unauthor|forbidden/i.test(errorName) || /权限/.test(message)) {
    return {
      code: 'tool-permission-denied',
      message,
      toolName,
      correlationId,
      retryable: false,
    };
  }

  if (/zod|validation|invalid/i.test(errorName) || /校验|验证/.test(message)) {
    return {
      code: 'tool-validation-failed',
      message,
      toolName,
      correlationId,
      retryable: false,
    };
  }

  return {
    code: 'tool-provider-failed',
    message,
    toolName,
    correlationId,
    retryable: true,
  };
}

export function createAnalysisToolRegistryUseCases({
  tools,
  auditRecorder,
  now = () => new Date().toISOString(),
}: ToolRegistryDependencies) {
  const registry = new Map(tools.map((tool) => [tool.definition.name, tool]));

  return {
    listToolDefinitions(): AnalysisToolDefinition[] {
      return [...registry.values()].map((tool) => {
        const availability = tool.resolveAvailability?.();

        if (!availability) {
          return tool.definition;
        }

        return {
          ...tool.definition,
          availability: availability.availability,
          availabilityReason: availability.reason,
        };
      });
    },

    getToolDefinition(toolName: AnalysisToolName): AnalysisToolDefinition | null {
      return (
        this.listToolDefinitions().find((definition) => definition.name === toolName) ??
        null
      );
    },

    async invokeTool({
      toolName,
      input,
      context,
    }: {
      toolName: AnalysisToolName;
      input: unknown;
      context: AnalysisToolInvocationContext;
    }): Promise<AnalysisToolInvocationResult> {
      const startedAt = now();
      const tool = registry.get(toolName);

      if (!tool) {
        const failure = buildFailure({
          code: 'tool-unavailable',
          message: `工具 ${toolName} 当前未注册。`,
          toolName,
          correlationId: context.correlationId,
          retryable: false,
          startedAt,
          finishedAt: now(),
        });

        if (auditRecorder && context.userId && context.organizationId) {
          await auditRecorder.recordToolInvocation({
            userId: context.userId,
            organizationId: context.organizationId,
            sessionId: context.sessionId,
            toolName,
            correlationId: context.correlationId,
            startedAt: failure.startedAt,
            finishedAt: failure.finishedAt,
            result: 'failed',
            errorCode: failure.error.code,
            errorMessage: failure.error.message,
            source: context.source,
          });
        }

        return failure;
      }

      try {
        const parsedInput = tool.inputSchema.parse(input);
        const rawOutput = await tool.invoke(parsedInput, context);
        const parsedOutput = tool.outputSchema.parse(rawOutput);
        const emptyReason = tool.classifyEmptyOutput?.(parsedOutput) ?? null;

        if (emptyReason) {
          const failure = buildFailure({
            code: 'tool-empty-result',
            message: emptyReason,
            toolName,
            correlationId: context.correlationId,
            retryable: false,
            startedAt,
            finishedAt: now(),
          });

          if (auditRecorder && context.userId && context.organizationId) {
            await auditRecorder.recordToolInvocation({
              userId: context.userId,
              organizationId: context.organizationId,
              sessionId: context.sessionId,
              toolName,
              correlationId: context.correlationId,
              startedAt: failure.startedAt,
              finishedAt: failure.finishedAt,
              result: 'failed',
              errorCode: failure.error.code,
              errorMessage: failure.error.message,
              source: context.source,
            });
          }

          return failure;
        }

        const success = {
          ok: true as const,
          toolName,
          correlationId: context.correlationId,
          startedAt,
          finishedAt: now(),
          output: parsedOutput,
        };

        if (auditRecorder && context.userId && context.organizationId) {
          await auditRecorder.recordToolInvocation({
            userId: context.userId,
            organizationId: context.organizationId,
            sessionId: context.sessionId,
            toolName,
            correlationId: context.correlationId,
            startedAt: success.startedAt,
            finishedAt: success.finishedAt,
            result: 'succeeded',
            source: context.source,
          });
        }

        return success;
      } catch (error) {
        const normalized = normalizeToolError(
          error,
          toolName,
          context.correlationId,
        );

        const failure = buildFailure({
          ...normalized,
          startedAt,
          finishedAt: now(),
        });

        if (auditRecorder && context.userId && context.organizationId) {
          await auditRecorder.recordToolInvocation({
            userId: context.userId,
            organizationId: context.organizationId,
            sessionId: context.sessionId,
            toolName,
            correlationId: context.correlationId,
            startedAt: failure.startedAt,
            finishedAt: failure.finishedAt,
            result: 'failed',
            errorCode: failure.error.code,
            errorMessage: failure.error.message,
            source: context.source,
          });
        }

        return failure;
      }
    },
  };
}
