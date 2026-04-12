/**
 * Tool Capability Binding 领域模型
 *
 * 定义 ontology-grounded 的工具能力绑定关系，
 * 使 tool selection 基于正式的业务语义绑定，而非字符串匹配。
 */

import type { DefinitionLifecycleState } from './models';

// ---------------------------------------------------------------------------
// Tool Capability Binding 核心类型
// ---------------------------------------------------------------------------

export type ToolCapabilityBinding = {
  id: string;
  ontologyVersionId: string;

  // 绑定的目标：计划步骤模板或能力标签
  boundStepTemplateKey: string | null; // 如绑定到具体步骤模板
  boundCapabilityTag: string | null;     // 如绑定到通用能力标签

  // 绑定的工具
  toolName: string; // 对应 AnalysisToolName

  // 绑定条件（何时启用此绑定）
  activationConditions: BindingActivationCondition[];

  // 绑定元数据
  description: string | null;
  status: DefinitionLifecycleState;
  priority: number; // 优先级，高优先级绑定优先选择

  // 版本控制
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

// ---------------------------------------------------------------------------
// 绑定激活条件
// ---------------------------------------------------------------------------

export type BindingActivationCondition =
  | { type: 'intent-type'; intentType: string }                    // 特定分析意图类型
  | { type: 'entity-present'; entityKey: string }                  // 特定实体存在
  | { type: 'metric-present'; metricKey: string }                    // 特定指标存在
  | { type: 'factor-present'; factorKey: string }                  // 特定因素存在
  | { type: 'time-semantic-present'; timeSemanticKey: string }     // 特定时间语义存在
  | { type: 'context-field-match'; field: string; pattern: string } // 上下文字段匹配
  | { type: 'always'; value: true };                                // 无条件激活

// ---------------------------------------------------------------------------
// 工具选择结果
// ---------------------------------------------------------------------------

export const TOOL_SELECTION_STATUS = [
  'success',        // 成功选择工具
  'ambiguous',      // 多候选绑定，需要决策
  'no-binding',     // 无可用绑定
  'tool-unavailable', // 绑定存在但工具不可用
] as const;

export type ToolSelectionStatus = (typeof TOOL_SELECTION_STATUS)[number];

export type OntologyBoundToolSelection = {
  status: ToolSelectionStatus;

  // 选中的工具（status 为 success 时填充）
  selectedTool: {
    toolName: string;
    bindingId: string;
    confidence: number;
    reason: string;
  } | null;

  // 候选列表（status 为 ambiguous 时填充）
  candidates: Array<{
    toolName: string;
    bindingId: string;
    confidence: number;
    matchedConditions: string[];
  }>;

  // 诊断信息（status 为 no-binding 或 tool-unavailable 时填充）
  diagnostics: {
    stepTemplateKey: string | null;
    requestedCapability: string | null;
    availableBindingsCount: number;
    matchedBindingsCount: number;
    failedReason: string;
  } | null;
};

// ---------------------------------------------------------------------------
// Binding 存储端口（定义在 application/ontology/ports.ts 中实现）
// ---------------------------------------------------------------------------

export type CreateToolCapabilityBindingInput = Omit<
  ToolCapabilityBinding,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: string; createdAt?: string; updatedAt?: string };

// ---------------------------------------------------------------------------
// Helper 函数
// ---------------------------------------------------------------------------

/**
 * 评估绑定是否激活
 */
export function evaluateBindingActivation(
  binding: ToolCapabilityBinding,
  context: {
    intentType?: string;
    presentEntityKeys?: string[];
    presentMetricKeys?: string[];
    presentFactorKeys?: string[];
    presentTimeSemanticKeys?: string[];
    contextFields?: Record<string, string>;
  },
): { active: boolean; matchedConditions: string[]; confidence: number } {
  const matchedConditions: string[] = [];
  let totalConfidence = 0;

  for (const condition of binding.activationConditions) {
    switch (condition.type) {
      case 'intent-type': {
        if (context.intentType === condition.intentType) {
          matchedConditions.push(`intent:${condition.intentType}`);
          totalConfidence += 1.0;
        }
        break;
      }
      case 'entity-present': {
        if (context.presentEntityKeys?.includes(condition.entityKey)) {
          matchedConditions.push(`entity:${condition.entityKey}`);
          totalConfidence += 1.0;
        }
        break;
      }
      case 'metric-present': {
        if (context.presentMetricKeys?.includes(condition.metricKey)) {
          matchedConditions.push(`metric:${condition.metricKey}`);
          totalConfidence += 1.0;
        }
        break;
      }
      case 'factor-present': {
        if (context.presentFactorKeys?.includes(condition.factorKey)) {
          matchedConditions.push(`factor:${condition.factorKey}`);
          totalConfidence += 1.0;
        }
        break;
      }
      case 'time-semantic-present': {
        if (context.presentTimeSemanticKeys?.includes(condition.timeSemanticKey)) {
          matchedConditions.push(`time:${condition.timeSemanticKey}`);
          totalConfidence += 1.0;
        }
        break;
      }
      case 'context-field-match': {
        const fieldValue = context.contextFields?.[condition.field];
        if (fieldValue && new RegExp(condition.pattern, 'i').test(fieldValue)) {
          matchedConditions.push(`field:${condition.field}`);
          totalConfidence += 0.8;
        }
        break;
      }
      case 'always': {
        matchedConditions.push('always');
        totalConfidence += 0.5;
        break;
      }
    }
  }

  // 所有条件都满足时才算激活
  const allConditionsMet = matchedConditions.length === binding.activationConditions.length;
  const averageConfidence = matchedConditions.length > 0 ? totalConfidence / matchedConditions.length : 0;

  return {
    active: allConditionsMet,
    matchedConditions,
    confidence: averageConfidence,
  };
}

/**
 * 选择最佳工具绑定
 */
export function selectBestToolBinding(
  bindings: ToolCapabilityBinding[],
  context: {
    intentType?: string;
    presentEntityKeys?: string[];
    presentMetricKeys?: string[];
    presentFactorKeys?: string[];
    presentTimeSemanticKeys?: string[];
    contextFields?: Record<string, string>;
  },
): OntologyBoundToolSelection {
  // 评估所有绑定
  const evaluatedBindings = bindings
    .map((binding) => {
      const evaluation = evaluateBindingActivation(binding, context);
      return {
        binding,
        ...evaluation,
      };
    })
    .filter((e) => e.active)
    .sort((a, b) => {
      // 按优先级降序，再按 confidence 降序
      if (b.binding.priority !== a.binding.priority) {
        return b.binding.priority - a.binding.priority;
      }
      return b.confidence - a.confidence;
    });

  if (evaluatedBindings.length === 0) {
    return {
      status: 'no-binding',
      selectedTool: null,
      candidates: [],
      diagnostics: {
        stepTemplateKey: null,
        requestedCapability: context.intentType ?? null,
        availableBindingsCount: bindings.length,
        matchedBindingsCount: 0,
        failedReason: '无匹配的 tool capability binding',
      },
    };
  }

  if (evaluatedBindings.length === 1) {
    const winner = evaluatedBindings[0];
    return {
      status: 'success',
      selectedTool: {
        toolName: winner.binding.toolName,
        bindingId: winner.binding.id,
        confidence: winner.confidence,
        reason: `匹配条件: ${winner.matchedConditions.join(', ')}`,
      },
      candidates: [],
      diagnostics: null,
    };
  }

  // 多个候选（歧义）
  const topCandidates = evaluatedBindings.slice(0, 3).map((e) => ({
    toolName: e.binding.toolName,
    bindingId: e.binding.id,
    confidence: e.confidence,
    matchedConditions: e.matchedConditions,
  }));

  return {
    status: 'ambiguous',
    selectedTool: null,
    candidates: topCandidates,
    diagnostics: {
      stepTemplateKey: null,
      requestedCapability: context.intentType ?? null,
      availableBindingsCount: bindings.length,
      matchedBindingsCount: evaluatedBindings.length,
      failedReason: `发现 ${evaluatedBindings.length} 个匹配的 binding，需要决策`,
    },
  };
}

// ---------------------------------------------------------------------------
// 默认 Binding Seeds（用于 bootstrap）
// ---------------------------------------------------------------------------

export function buildDefaultToolCapabilityBindingSeeds(
  versionId: string,
  ts: string,
  createdBy: string,
): CreateToolCapabilityBindingInput[] {
  return [
    // 语义查询类绑定
    {
      id: `tcb-cube-query-collection-rate-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'metric-query',
      boundCapabilityTag: 'semantic-query',
      toolName: 'cube.semantic-query',
      activationConditions: [
        { type: 'metric-present', metricKey: 'collection-rate' },
      ],
      description: '当分析涉及收缴率指标时，使用 Cube 语义查询',
      status: 'approved',
      priority: 100,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },
    {
      id: `tcb-cube-query-default-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'metric-query',
      boundCapabilityTag: 'semantic-query',
      toolName: 'cube.semantic-query',
      activationConditions: [{ type: 'always', value: true }],
      description: '默认的 Cube 语义查询绑定',
      status: 'approved',
      priority: 10,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },

    // 图谱查询类绑定
    {
      id: `tcb-neo4j-factor-expansion-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'factor-expansion',
      boundCapabilityTag: 'graph-query',
      toolName: 'neo4j.graph-query',
      activationConditions: [
        { type: 'intent-type', intentType: 'causal-analysis' },
      ],
      description: '因果分析场景下的因素扩展，使用 Neo4j 图谱查询',
      status: 'approved',
      priority: 90,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },
    {
      id: `tcb-neo4j-default-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'factor-expansion',
      boundCapabilityTag: 'graph-query',
      toolName: 'neo4j.graph-query',
      activationConditions: [{ type: 'always', value: true }],
      description: '默认的 Neo4j 图谱查询绑定',
      status: 'approved',
      priority: 10,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },

    // ERP 查询类绑定
    {
      id: `tcb-erp-master-data-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'master-data-lookup',
      boundCapabilityTag: 'erp-read',
      toolName: 'erp.read-model',
      activationConditions: [
        { type: 'entity-present', entityKey: 'organization' },
      ],
      description: '需要查询 ERP 主数据时使用',
      status: 'approved',
      priority: 80,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },
    {
      id: `tcb-erp-default-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'master-data-lookup',
      boundCapabilityTag: 'erp-read',
      toolName: 'erp.read-model',
      activationConditions: [{ type: 'always', value: true }],
      description: '默认的 ERP 查询绑定',
      status: 'approved',
      priority: 10,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },

    // LLM 结构化分析绑定
    {
      id: `tcb-llm-structured-${versionId}`,
      ontologyVersionId: versionId,
      boundStepTemplateKey: 'structured-analysis',
      boundCapabilityTag: 'llm-analysis',
      toolName: 'llm.structured-analysis',
      activationConditions: [{ type: 'always', value: true }],
      description: 'LLM 结构化分析任务的默认绑定',
      status: 'approved',
      priority: 50,
      createdAt: ts,
      updatedAt: ts,
      createdBy,
    },
  ];
}
