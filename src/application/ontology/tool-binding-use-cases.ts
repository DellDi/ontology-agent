import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import {
  toLegacyContextProjection,
  type OntologyGroundedContext,
} from '@/domain/ontology/grounding';
import {
  evaluateBindingActivation,
  type ToolCapabilityBinding,
} from '@/domain/ontology/tool-binding';
import type { AnalysisToolName, ToolSelectionDecision } from '@/domain/tooling/models';

import type {
  OntologyToolCapabilityBindingStore,
  OntologyVersionStore,
} from './ports';

const STEP_CAPABILITY_TAGS: Record<string, string[]> = {
  'confirm-analysis-scope': ['capability-status'],
  'confirm-query-scope': ['capability-status'],
  'return-metric-result': ['semantic-query'],
  'inspect-metric-change': ['semantic-query'],
  'validate-candidate-factors': ['graph-query', 'erp-read'],
  'synthesize-attribution': [
    'semantic-query',
    'graph-query',
    'erp-read',
    'llm-analysis',
  ],
};

function getCandidateBindingsForStep(
  bindings: ToolCapabilityBinding[],
  stepId: string,
) {
  const capabilityTags = new Set(STEP_CAPABILITY_TAGS[stepId] ?? []);

  return bindings.filter(
    (binding) =>
      binding.status === 'approved' &&
      (binding.boundStepTemplateKey === stepId ||
        (binding.boundCapabilityTag !== null &&
          capabilityTags.has(binding.boundCapabilityTag))),
  );
}

function buildBindingContext(input: {
  groundedContext?: OntologyGroundedContext;
  intentType?: AnalysisIntentType;
  questionText?: string;
  stepTitle?: string;
  stepObjective?: string;
}) {
  const projection = input.groundedContext
    ? toLegacyContextProjection(input.groundedContext)
    : null;

  return {
    intentType: input.intentType,
    presentEntityKeys: projection?.entityKeys ?? [],
    presentMetricKeys: projection?.metricKeys ?? [],
    presentFactorKeys: projection?.factorKeys ?? [],
    presentTimeSemanticKeys: projection?.timeSemanticKeys ?? [],
    contextFields: {
      questionText: input.questionText ?? '',
      stepTitle: input.stepTitle ?? '',
      stepObjective: input.stepObjective ?? '',
    },
  };
}

function dedupeToolSelections(
  bindings: Array<{
    binding: ToolCapabilityBinding;
    matchedConditions: string[];
    confidence: number;
  }>,
  availableToolNames: Set<AnalysisToolName>,
): ToolSelectionDecision[] {
  const selectedByTool = new Map<AnalysisToolName, ToolSelectionDecision>();

  for (const item of bindings) {
    if (!availableToolNames.has(item.binding.toolName as AnalysisToolName)) {
      continue;
    }

    const toolName = item.binding.toolName as AnalysisToolName;
    const current = selectedByTool.get(toolName);
    const next: ToolSelectionDecision = {
      toolName,
      objective:
        item.binding.description ??
        `命中 ontology binding：${item.matchedConditions.join(', ') || 'always'}`,
      confidence: item.confidence,
    };

    if (!current || next.confidence > current.confidence) {
      selectedByTool.set(toolName, next);
    }
  }

  return [...selectedByTool.values()];
}

export function createOntologyToolBindingUseCases({
  versionStore,
  toolCapabilityBindingStore,
}: {
  versionStore: OntologyVersionStore;
  toolCapabilityBindingStore: OntologyToolCapabilityBindingStore;
}) {
  return {
    async selectToolsForStep(input: {
      stepId: string;
      availableToolNames: AnalysisToolName[];
      groundedContext?: OntologyGroundedContext;
      intentType?: AnalysisIntentType;
      questionText?: string;
      stepTitle?: string;
      stepObjective?: string;
    }): Promise<{
      strategy: string;
      tools: ToolSelectionDecision[];
    } | null> {
      // Story 9.4 AC3：运行时默认只绑定 approved + published 版本的工具。
      // approved 但未 publish 的候选必须通过 publishVersion 形成发布边界后才参与工具选择。
      const version = input.groundedContext?.ontologyVersionId
        ? await versionStore.findById(input.groundedContext.ontologyVersionId)
        : await versionStore.findCurrentPublished();

      if (!version) {
        return null;
      }

      const allBindings = await toolCapabilityBindingStore.findByVersionId(version.id);
      const candidateBindings = getCandidateBindingsForStep(allBindings, input.stepId);

      if (candidateBindings.length === 0) {
        return null;
      }

      const bindingContext = buildBindingContext(input);
      const matchedBindings = candidateBindings
        .map((binding) => ({
          binding,
          ...evaluateBindingActivation(binding, bindingContext),
        }))
        .filter((item) => item.active)
        .sort((left, right) => {
          if (right.binding.priority !== left.binding.priority) {
            return right.binding.priority - left.binding.priority;
          }

          return right.confidence - left.confidence;
        });

      const tools = dedupeToolSelections(
        matchedBindings,
        new Set(input.availableToolNames),
      );

      if (tools.length === 0) {
        return null;
      }

      return {
        strategy: `基于 ontology binding 选择工具（version: ${version.semver}）`,
        tools,
      };
    },
  };
}
