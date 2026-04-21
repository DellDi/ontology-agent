/**
 * Vercel AI SDK Adapter
 *
 * 边界约束：
 *   - 本 adapter 位于 infrastructure 层，不得被 domain / application 反向依赖
 *   - 仅负责把 application 层的 `AiRuntimeProjection` 映射成 Vercel AI SDK 可以消费的 UIMessage 形态
 *   - 不替代 execution truth、不替代 result persistence、不替代 ontology governance
 *   - Story 10.1 First-Cut 仅提供类型安全的结构映射，不引入 client-side `useChat` 等 hook
 */

import type { UIMessage, UIMessagePart } from 'ai';

import type {
  AiRuntimeMessage,
  AiRuntimeMessagePart,
  AiRuntimeProjection,
} from '@/application/ai-runtime';

/**
 * UIMessage 的 DATA_PARTS 形状：以运行时 part kind 作为 data 命名空间，
 * 这样 SDK 消费端可以通过 `type: 'data-status-banner'` 等前缀直接区分。
 */
export type AiRuntimeUIDataParts = {
  'status-banner': Extract<AiRuntimeMessagePart, { kind: 'status-banner' }>;
  'step-timeline': Extract<AiRuntimeMessagePart, { kind: 'step-timeline' }>;
  'evidence-card': Extract<AiRuntimeMessagePart, { kind: 'evidence-card' }>;
  'conclusion-card': Extract<AiRuntimeMessagePart, { kind: 'conclusion-card' }>;
  'resume-anchor': Extract<AiRuntimeMessagePart, { kind: 'resume-anchor' }>;
};

export type AiRuntimeUIMessageMetadata = {
  sessionId: string;
  executionId: string;
  status: AiRuntimeProjection['status'];
  lastSequence: number;
  isTerminal: boolean;
  /** Story 10.1.p3：从 projection 透传，而非 adapter 独立引入常量，保持事实单一来源。 */
  schemaVersion: number;
  contractVersion: number;
};

export type AiRuntimeUIMessage = UIMessage<
  AiRuntimeUIMessageMetadata,
  AiRuntimeUIDataParts
>;

function toDataPart(
  part: AiRuntimeMessagePart,
): UIMessagePart<AiRuntimeUIDataParts, never> {
  // Story 10.1.p1：所有 data part 的 id 必须直接沿用 application 层 `part.id`，
  // adapter 不得重新生成，避免 renderer registry 与 application contract 之间出现 id 漂移。
  switch (part.kind) {
    case 'status-banner':
      return { type: 'data-status-banner', id: part.id, data: part };
    case 'step-timeline':
      return { type: 'data-step-timeline', id: part.id, data: part };
    case 'evidence-card':
      return { type: 'data-evidence-card', id: part.id, data: part };
    case 'conclusion-card':
      return { type: 'data-conclusion-card', id: part.id, data: part };
    case 'resume-anchor':
      return { type: 'data-resume-anchor', id: part.id, data: part };
  }
}

function toUIMessage(
  message: AiRuntimeMessage,
  projection: AiRuntimeProjection,
): AiRuntimeUIMessage {
  return {
    id: message.id,
    role: message.role,
    metadata: {
      sessionId: projection.sessionId,
      executionId: projection.executionId,
      status: projection.status,
      lastSequence: projection.lastSequence,
      isTerminal: projection.isTerminal,
      schemaVersion: projection.schemaVersion,
      contractVersion: projection.contractVersion,
    },
    parts: message.parts.map((part) => toDataPart(part)),
  };
}

/**
 * 把 application 层 projection 映射为 Vercel AI SDK 可消费的 UIMessage 列表。
 *
 * 调用方（如 SSE stream route）可以用它产出 SDK 兼容的 payload，
 * 但本 story 不强制要求立刻切换传输通道。
 */
export function projectionToUIMessages(
  projection: AiRuntimeProjection,
): AiRuntimeUIMessage[] {
  return projection.messages.map((message) => toUIMessage(message, projection));
}
