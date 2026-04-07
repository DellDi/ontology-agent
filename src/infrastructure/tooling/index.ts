import { createAnalysisExecutionUseCases } from '@/application/analysis-execution/use-cases';
import {
  createAnalysisToolRegistryUseCases,
} from '@/application/tooling/use-cases';
import {
  cubeSemanticQueryInputSchema,
  cubeSemanticQueryOutputSchema,
  erpReadToolInputSchema,
  erpReadToolOutputSchema,
  type ErpReadToolInput,
  llmStructuredAnalysisInputSchema,
  llmStructuredAnalysisOutputSchema,
  neo4jGraphQueryInputSchema,
  neo4jGraphQueryOutputSchema,
  platformCapabilityStatusInputSchema,
  platformCapabilityStatusOutputSchema,
} from '@/application/tooling/models';
import type { AuthSession } from '@/domain/auth/models';
import type { AnalysisToolDefinition } from '@/domain/tooling/models';
import { getCubeProviderConfig } from '@/infrastructure/cube/config';
import { isNeo4jConfigured } from '@/infrastructure/neo4j/config';
import { getLlmProviderConfig } from '@/infrastructure/llm/config';

type AnalysisToolingDependencies = {
  analysisAiUseCases: {
    runTask: (request: {
      taskType: 'tool-selection' | 'analysis-intent' | 'analysis-context' | 'analysis-plan' | 'conclusion-summary';
      input: unknown;
      context: {
        userId: string;
        organizationId: string;
        purpose: string;
        timeoutMs?: number;
        sessionId?: string;
      };
      model?: string;
    }) => Promise<{
      taskType: string;
      ok: boolean;
      value: unknown;
      issues: { path: string; message: string }[];
      providerResult: {
        provider: string;
        model: string;
        finishReason: string | null;
      };
    }>;
    checkHealth?: () => Promise<{
      ok: boolean;
      provider: string;
      model: string;
      latencyMs: number;
      checkedAt: string;
      status: number;
    }>;
  };
  erpReadUseCases: {
    listOrganizations: (session: AuthSession) => Promise<Record<string, unknown>[]>;
    listProjects: (session: AuthSession) => Promise<Record<string, unknown>[]>;
    listCurrentOwners: (session: AuthSession) => Promise<Record<string, unknown>[]>;
    listChargeItems: (session: AuthSession) => Promise<Record<string, unknown>[]>;
    listReceivables: (session: AuthSession) => Promise<Record<string, unknown>[]>;
    listPayments: (session: AuthSession) => Promise<Record<string, unknown>[]>;
    listServiceOrders: (session: AuthSession) => Promise<Record<string, unknown>[]>;
  };
  semanticQueryUseCases: {
    runMetricQuery: (request: unknown) => Promise<{
      metric: string;
      rows: {
        value: number | null;
        time: string | null;
        dimensions: Record<string, string | null>;
      }[];
    }>;
    checkHealth?: () => Promise<{
      ok: boolean;
      status: number;
      latencyMs: number;
      checkedAt: string;
      apiUrl: string;
    }>;
  };
  graphUseCases: {
    expandCandidateFactors: (request: unknown) => Promise<{
      mode: 'expand' | 'skip';
      factors: {
        factorKey: string;
        factorLabel: string;
        explanation: string;
        relationType: string;
        direction: string;
        source: string;
      }[];
    }>;
    checkHealth?: () => Promise<{
      ok: boolean;
      status: 'ready' | 'disabled' | 'error';
    }>;
  };
};

function buildAvailability(
  ok: boolean,
  reason?: string,
): {
  availability: AnalysisToolDefinition['availability'];
  reason?: string;
} {
  return ok
    ? { availability: 'ready' }
    : { availability: 'degraded', reason };
}

function resolveLlmAvailability() {
  try {
    getLlmProviderConfig();
    return buildAvailability(true);
  } catch (error) {
    return buildAvailability(
      false,
      error instanceof Error ? error.message : 'LLM provider is not configured.',
    );
  }
}

function resolveCubeAvailability() {
  try {
    getCubeProviderConfig();
    return buildAvailability(true);
  } catch (error) {
    return buildAvailability(
      false,
      error instanceof Error ? error.message : 'Cube is not configured.',
    );
  }
}

function resolveNeo4jAvailability() {
  return isNeo4jConfigured()
    ? buildAvailability(true)
    : buildAvailability(false, 'Neo4j is not configured.');
}

async function resolveCapabilityStatus({
  analysisAiUseCases,
  semanticQueryUseCases,
  graphUseCases,
}: Pick<
  AnalysisToolingDependencies,
  'analysisAiUseCases' | 'semanticQueryUseCases' | 'graphUseCases'
>) {
  const checkedAt = new Date().toISOString();
  const llmAvailability = resolveLlmAvailability();
  const cubeAvailability = resolveCubeAvailability();
  const neo4jAvailability = resolveNeo4jAvailability();

  const llmHealth =
    analysisAiUseCases.checkHealth && llmAvailability.availability === 'ready'
      ? await analysisAiUseCases.checkHealth()
      : null;
  const cubeHealth =
    semanticQueryUseCases.checkHealth && cubeAvailability.availability === 'ready'
      ? await semanticQueryUseCases.checkHealth()
      : null;
  const neo4jHealth =
    graphUseCases.checkHealth && neo4jAvailability.availability === 'ready'
      ? await graphUseCases.checkHealth()
      : null;

  return {
    checkedAt,
    capabilities: {
      llm: {
        status:
          llmAvailability.availability === 'ready' && llmHealth?.ok !== false
            ? 'ready'
            : 'degraded',
        detail:
          llmAvailability.reason ||
          (llmHealth && !llmHealth.ok
            ? `LLM health check failed with status ${llmHealth.status}.`
            : undefined),
      },
      erp: {
        status: 'ready',
      },
      cube: {
        status:
          cubeAvailability.availability === 'ready' && cubeHealth?.ok !== false
            ? 'ready'
            : 'degraded',
        detail:
          cubeAvailability.reason ||
          (cubeHealth && !cubeHealth.ok
            ? `Cube health check failed with status ${cubeHealth.status}.`
            : undefined),
      },
      neo4j: {
        status:
          neo4jAvailability.availability === 'ready' &&
          neo4jHealth?.ok !== false &&
          neo4jHealth?.status !== 'error'
            ? 'ready'
            : 'degraded',
        detail:
          neo4jAvailability.reason ||
          (neo4jHealth && !neo4jHealth.ok
            ? `Neo4j health check returned ${neo4jHealth.status}.`
            : undefined),
      },
    },
  };
}

function sanitizeRecords(records: Record<string, unknown>[]) {
  return records.map((record) =>
    Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    ),
  );
}

export function createAnalysisToolingServices({
  analysisAiUseCases,
  erpReadUseCases,
  semanticQueryUseCases,
  graphUseCases,
}: AnalysisToolingDependencies) {
  const toolRegistryUseCases = createAnalysisToolRegistryUseCases({
    tools: [
      {
        definition: {
          name: 'llm.structured-analysis',
          title: 'LLM 结构化分析',
          description: '通过统一结构化 guardrail 调用模型任务。',
          runtime: 'shared',
          availability: 'ready',
          inputSchemaLabel: 'llmStructuredAnalysisInputSchema',
          outputSchemaLabel: 'llmStructuredAnalysisOutputSchema',
        },
        resolveAvailability: resolveLlmAvailability,
        inputSchema: llmStructuredAnalysisInputSchema,
        outputSchema: llmStructuredAnalysisOutputSchema,
        async invoke(input) {
          const result = await analysisAiUseCases.runTask(
            input as Parameters<typeof analysisAiUseCases.runTask>[0],
          );

          return {
            taskType: result.taskType,
            ok: result.ok,
            value: result.value,
            issues: result.issues,
            provider: result.providerResult.provider,
            model: result.providerResult.model,
            finishReason: result.providerResult.finishReason,
          };
        },
      },
      {
        definition: {
          name: 'erp.read-model',
          title: 'ERP 只读防腐层',
          description: '通过受控读模型访问 ERP 主数据与事实数据。',
          runtime: 'shared',
          availability: 'ready',
          inputSchemaLabel: 'erpReadToolInputSchema',
          outputSchemaLabel: 'erpReadToolOutputSchema',
        },
        resolveAvailability: () => buildAvailability(true),
        inputSchema: erpReadToolInputSchema,
        outputSchema: erpReadToolOutputSchema,
        async invoke(input) {
          const commandHandlers = {
            organizations: erpReadUseCases.listOrganizations,
            projects: erpReadUseCases.listProjects,
            owners: erpReadUseCases.listCurrentOwners,
            'charge-items': erpReadUseCases.listChargeItems,
            receivables: erpReadUseCases.listReceivables,
            payments: erpReadUseCases.listPayments,
            'service-orders': erpReadUseCases.listServiceOrders,
          } as const;

          const typedInput = input as ErpReadToolInput;
          const items = await commandHandlers[typedInput.resource](
            typedInput.session,
          );

          return {
            resource: typedInput.resource,
            count: items.length,
            items: sanitizeRecords(items),
          };
        },
        classifyEmptyOutput(output) {
          const typedOutput = output as { count: number; resource: string };
          return typedOutput.count === 0
            ? `ERP 工具 ${typedOutput.resource} 未返回任何记录。`
            : null;
        },
      },
      {
        definition: {
          name: 'cube.semantic-query',
          title: 'Cube 语义查询',
          description: '通过受治理指标契约访问 Cube 语义层。',
          runtime: 'shared',
          availability: 'ready',
          inputSchemaLabel: 'cubeSemanticQueryInputSchema',
          outputSchemaLabel: 'cubeSemanticQueryOutputSchema',
        },
        resolveAvailability: resolveCubeAvailability,
        inputSchema: cubeSemanticQueryInputSchema,
        outputSchema: cubeSemanticQueryOutputSchema,
        async invoke(input) {
          const result = await semanticQueryUseCases.runMetricQuery(input);

          return {
            metric: result.metric,
            rowCount: result.rows.length,
            rows: result.rows.map((row) => ({
              value: row.value,
              time: row.time,
              dimensions: row.dimensions,
            })),
          };
        },
        classifyEmptyOutput(output) {
          const typedOutput = output as { rowCount: number; metric: string };
          return typedOutput.rowCount === 0
            ? `Cube 指标 ${typedOutput.metric} 未返回任何结果。`
            : null;
        },
      },
      {
        definition: {
          name: 'neo4j.graph-query',
          title: 'Neo4j 图谱查询',
          description: '通过图谱 adapter 扩展候选因素与关系依据。',
          runtime: 'shared',
          availability: 'ready',
          inputSchemaLabel: 'neo4jGraphQueryInputSchema',
          outputSchemaLabel: 'neo4jGraphQueryOutputSchema',
        },
        resolveAvailability: resolveNeo4jAvailability,
        inputSchema: neo4jGraphQueryInputSchema,
        outputSchema: neo4jGraphQueryOutputSchema,
        async invoke(input) {
          const result = await graphUseCases.expandCandidateFactors(input);

          return {
            mode: result.mode,
            factors: result.factors.map((factor) => ({
              factorKey: factor.factorKey,
              factorLabel: factor.factorLabel,
              explanation: factor.explanation,
              relationType: factor.relationType,
              direction: factor.direction,
              source: factor.source,
            })),
          };
        },
        classifyEmptyOutput(output) {
          const typedOutput = output as { factors: unknown[] };
          return typedOutput.factors.length === 0
            ? 'Neo4j 图谱查询未返回候选因素。'
            : null;
        },
      },
      {
        definition: {
          name: 'platform.capability-status',
          title: '平台能力状态',
          description: '汇总 LLM、ERP、Cube、Neo4j 的配置与健康状态。',
          runtime: 'shared',
          availability: 'ready',
          inputSchemaLabel: 'platformCapabilityStatusInputSchema',
          outputSchemaLabel: 'platformCapabilityStatusOutputSchema',
        },
        resolveAvailability: () => buildAvailability(true),
        inputSchema: platformCapabilityStatusInputSchema,
        outputSchema: platformCapabilityStatusOutputSchema,
        async invoke() {
          return await resolveCapabilityStatus({
            analysisAiUseCases,
            semanticQueryUseCases,
            graphUseCases,
          });
        },
      },
    ],
  });

  const analysisExecutionUseCases = createAnalysisExecutionUseCases({
    toolRegistryUseCases,
    analysisAiUseCases: {
      async runTask(request) {
        const result = await analysisAiUseCases.runTask(request);

        return {
          ok: result.ok,
          value: (result.value ?? {}) as {
            strategy?: string;
            tools?: { toolName: string; objective: string; confidence: number }[];
          },
        };
      },
    },
  });

  return {
    toolRegistryUseCases,
    analysisExecutionUseCases,
  };
}
