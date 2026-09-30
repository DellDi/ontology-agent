/**
 * AI Elements 状态映射 — 把会话视图模型中的业务状态翻译为
 * AI Elements 组件期望的 AI SDK 类型取值。
 *
 * 约束：
 *   - 纯函数，不依赖 React / DOM / 副作用。
 *   - 不引入新的事实源；输入均为 conversation-view-model 既有类型。
 */

import type { ChatStatus, ToolUIPart } from 'ai';

import type {
  ConversationAssistantStatus,
  SubStepEntry,
  ToolActivitySummary,
} from './conversation-view-model';

/**
 * 会话执行状态 → AI SDK ChatStatus（驱动 PromptInputSubmit 图标语义）。
 *   queued/running → submitted/streaming；终态 → ready；失败/断流 → error。
 */
export function toChatStatus(input: {
  status?: ConversationAssistantStatus;
  sending?: boolean;
}): ChatStatus {
  if (input.sending) return 'submitted';
  switch (input.status) {
    case 'queued':
      return 'submitted';
    case 'running':
      return 'streaming';
    case 'failed':
    case 'disconnected':
      return 'error';
    case 'completed':
    default:
      return 'ready';
  }
}

/**
 * 工具活动状态 → ToolUIPart['state']（驱动 Tool 组件的状态徽标）。
 *   selected → input-streaming；running → input-available；
 *   completed → output-available；failed → output-error。
 */
export function toToolPartState(
  status: ToolActivitySummary['status'] | SubStepEntry['status'],
): ToolUIPart['state'] {
  switch (status) {
    case 'running':
      return 'input-available';
    case 'completed':
      return 'output-available';
    case 'failed':
      return 'output-error';
    default:
      return 'input-streaming';
  }
}

/** 内部工具名 → ToolUIPart['type']（`tool-${name}` 约定）。 */
export function toToolType(toolName: string): ToolUIPart['type'] {
  return `tool-${toolName}` as ToolUIPart['type'];
}
