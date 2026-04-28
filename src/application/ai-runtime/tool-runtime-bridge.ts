/**
 * Tool Runtime Bridge（Story 10.1 仅占位定义）
 *
 * ⚠️ 本接口仅用于为未来 tool invocation / approval / memory / knowledge / skills prompts 预留统一
 * 接入面；Story 10.1 First-Cut 只承诺接口契约，不承诺任何治理、调度、执行能力。
 *
 * 明确不做的事：
 *   - 不是 ontology registry，也不是 execution orchestration
 *   - 不是新的 worker 编排层
 *   - 不是 ToolCapabilityBinding 的替代品（后者仍由 ontology governance 持有）
 *
 * 任何真正的工具执行、审批或治理，仍应走已有的 application / infrastructure 边界。
 */

import type { AnalysisToolDefinition } from '@/domain/tooling/models';

export type AiRuntimeToolDescriptor = {
  /** 工具的稳定标识，预期与 ontology tool registry 对齐。 */
  toolName: string;
  /** 面向 UI 展示的人读标题。 */
  displayName: string;
  /** 面向 UI 的简短说明，用于 action layer / context rail。 */
  description?: string;
  /** 当前可用性只来自既有 tool registry，不在 runtime bridge 内重新探测。 */
  status: 'available' | 'unavailable';
  /** 不可用时的人读原因，来自 tool registry availabilityReason。 */
  unavailableReason?: string;
  /** 是否需要人工审批。First-Cut 仅保留字段，不承诺审批链路已落地。 */
  requiresApproval?: boolean;
};

/**
 * 最小骨架：仅暴露"列出当前运行时可感知的工具描述"一种能力。
 *
 * 调用方不得把本接口视作 canonical tool registry；
 * 未来 Story 10.4 / Epic 9.x 再引入真实实现时，应在更下游实现中消费此边界。
 */
export type AiRuntimeToolBridge = {
  listTools(): readonly AiRuntimeToolDescriptor[];
};

/**
 * 默认空实现：Story 10.1 不交付任何工具事实；
 * 交互层如无 ontology tool 输入，应直接消费这个空 bridge，避免把"未实现"伪装成"运行中"。
 */
export function createEmptyAiRuntimeToolBridge(): AiRuntimeToolBridge {
  const tools: readonly AiRuntimeToolDescriptor[] = Object.freeze([]);
  return {
    listTools: () => tools,
  };
}

export function createAiRuntimeToolBridgeFromRegistry(input: {
  listToolDefinitions: () => readonly AnalysisToolDefinition[];
}): AiRuntimeToolBridge {
  return {
    listTools: () =>
      input.listToolDefinitions().map((tool) => ({
        toolName: tool.name,
        displayName: tool.title,
        description: tool.description,
        status: tool.availability === 'ready' ? 'available' : 'unavailable',
        unavailableReason: tool.availabilityReason,
        requiresApproval: false,
      })),
  };
}
