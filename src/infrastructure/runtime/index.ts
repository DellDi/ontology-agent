import 'server-only';

import type {
  AnalysisToolDefinition,
  AnalysisToolInvocationContext,
  AnalysisToolInvocationResult,
  AnalysisToolName,
} from '@/domain/tooling/models';
import { createRuntimeBridgeUseCases } from '@/application/runtime/use-cases';
import type {
  RuntimeCapabilityAdapter,
} from '@/application/runtime/ports';
import type {
  RuntimeCapabilityDescriptor,
  RuntimeCapabilityStatus,
} from '@/domain/runtime/models';
import { STRUCTURED_PROMPT_TASK_TYPES } from '@/infrastructure/llm/prompt-registry';

type ToolRegistryUseCases = {
  listToolDefinitions: () => readonly AnalysisToolDefinition[];
  invokeTool: (input: {
    toolName: AnalysisToolName;
    input: unknown;
    context: AnalysisToolInvocationContext;
  }) => Promise<AnalysisToolInvocationResult>;
};

type RuntimeBridgeInfrastructureDependencies = {
  toolRegistryUseCases: ToolRegistryUseCases;
  now?: () => string;
  memoryAdapters?: RuntimeCapabilityAdapter[];
  knowledgeAdapters?: RuntimeCapabilityAdapter[];
};

function mapToolStatus(
  tool: AnalysisToolDefinition,
): RuntimeCapabilityStatus {
  return tool.availability === 'ready' ? 'available' : 'degraded';
}

function buildToolDescriptor(input: {
  tool: AnalysisToolDefinition;
  now: () => string;
}): RuntimeCapabilityDescriptor {
  const status = mapToolStatus(input.tool);
  return {
    id: `tool:${input.tool.name}`,
    surface: 'tools',
    title: input.tool.title,
    description: input.tool.description,
    status,
    version: {
      schemaVersion: 1,
      contractVersion: 1,
      capabilityVersion: input.tool.name,
    },
    provenance: {
      source: 'analysis-tool-registry',
      sourceType: 'tool-registry',
      retrievedAt: input.now(),
    },
    ownership: {
      ownerType: 'platform',
      ownerId: 'ontology-agent',
      visibility: 'platform',
    },
    availability: {
      status,
      reasonCode: status === 'degraded' ? 'tool-degraded' : undefined,
      reason:
        input.tool.availabilityReason ??
        'Tool capability is available from the analysis tool registry.',
      checkedAt: input.now(),
      retryable: status === 'degraded',
    },
    approval: {
      required: input.tool.name !== 'platform.capability-status',
      policyId:
        input.tool.name === 'platform.capability-status'
          ? 'runtime-tool-readonly-status'
          : 'runtime-tool-sensitive-execution',
      reason:
        input.tool.name === 'platform.capability-status'
          ? 'Read-only platform status does not mutate or export business data.'
          : 'Tool execution can access scoped business context and requires governance approval.',
    },
    metadata: {
      runtime: input.tool.runtime,
      inputSchemaLabel: input.tool.inputSchemaLabel,
      outputSchemaLabel: input.tool.outputSchemaLabel,
    },
  };
}

function createToolRegistryRuntimeAdapter(input: {
  toolRegistryUseCases: ToolRegistryUseCases;
  now: () => string;
}): RuntimeCapabilityAdapter {
  return {
    surface: 'tools',
    async listCapabilities() {
      return input.toolRegistryUseCases
        .listToolDefinitions()
        .map((tool) => buildToolDescriptor({ tool, now: input.now }));
    },
    async invokeCapability({ capabilityId, input: rawInput, context }) {
      if (!capabilityId.startsWith('tool:')) {
        return {
          ok: false,
          reason: `Runtime tool capability id must start with "tool:": ${capabilityId}`,
        };
      }

      const toolName = capabilityId.replace(/^tool:/, '') as AnalysisToolName;
      const result = await input.toolRegistryUseCases.invokeTool({
        toolName,
        input: rawInput,
        context: {
          correlationId: context.correlationId,
          source: context.source,
          sessionId: context.sessionId,
          userId: context.actor.userId,
          organizationId: context.actor.organizationId,
        },
      });

      if (!result.ok) {
        return { ok: false, reason: result.error.message };
      }

      return { ok: true, output: result.output };
    },
  };
}

function buildSkillDescriptor(input: {
  taskType: string;
  now: () => string;
}): RuntimeCapabilityDescriptor {
  return {
    id: `skill:${input.taskType}`,
    surface: 'skills',
    title: `Structured prompt: ${input.taskType}`,
    description:
      'Versioned structured prompt capability from the server-side prompt registry.',
    status: 'available',
    version: {
      schemaVersion: 1,
      contractVersion: 1,
      capabilityVersion: input.taskType,
    },
    provenance: {
      source: 'structured-prompt-registry',
      sourceType: 'prompt-registry',
      retrievedAt: input.now(),
    },
    ownership: {
      ownerType: 'platform',
      ownerId: 'ontology-agent',
      visibility: 'platform',
    },
    availability: {
      status: 'available',
      reason: 'Skill prompt is registered server-side.',
      checkedAt: input.now(),
    },
    approval: {
      required: false,
      policyId: 'runtime-skill-prompt-readonly',
      reason:
        'Skill prompts provide model context only and do not replace governed business facts.',
    },
    metadata: {
      promptRegistry: 'structured-analysis',
      taskType: input.taskType,
    },
  };
}

function createSkillsPromptRuntimeAdapter(input: {
  now: () => string;
}): RuntimeCapabilityAdapter {
  return {
    surface: 'skills',
    async listCapabilities() {
      return STRUCTURED_PROMPT_TASK_TYPES.map((taskType) =>
        buildSkillDescriptor({ taskType, now: input.now }),
      );
    },
  };
}

export function createServerRuntimeBridgeServices({
  toolRegistryUseCases,
  now = () => new Date().toISOString(),
  memoryAdapters = [],
  knowledgeAdapters = [],
}: RuntimeBridgeInfrastructureDependencies) {
  const runtimeBridgeUseCases = createRuntimeBridgeUseCases({
    now,
    adapters: {
      memory: memoryAdapters,
      knowledge: knowledgeAdapters,
      skills: [createSkillsPromptRuntimeAdapter({ now })],
      tools: [
        createToolRegistryRuntimeAdapter({
          toolRegistryUseCases,
          now,
        }),
      ],
    },
  });

  return {
    serverOnly: true,
    runtimeBridgeUseCases,
  };
}

const runtimeInfrastructureModule = {
  createServerRuntimeBridgeServices,
};

export default runtimeInfrastructureModule;
