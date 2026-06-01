/**
 * Conversation Thread View Model — 多轮追问线性对话线程视图模型。
 *
 * 将多轮追问（每轮对应一次 execution）组合为线性消息列表，
 * 每轮复用 buildConversationViewModel 生成独立的 user + assistant 消息对，
 * 仅 activeTurnId 对应的轮次标记为展开（isExpanded），其余折叠。
 *
 * 约束：
 *   - 纯函数，不依赖 React / DOM / 副作用。
 *   - 不修改 conversation-view-model.ts 中已有的类型或函数。
 */

import {
  buildConversationViewModel,
  type AnalysisConversationViewModel,
  type BuildConversationViewModelInput,
} from './conversation-view-model';
import type { AiRuntimeProjection } from '@/application/ai-runtime';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 线程中的单轮对话，包含 execution 标识、视图模型与展开状态。 */
export type ConversationTurn = {
  executionId: string;
  viewModel: AnalysisConversationViewModel;
  isExpanded: boolean;
};

/** 多轮追问组成的对话线程视图模型。 */
export type ConversationThreadViewModel = {
  turns: ConversationTurn[];
  activeTurnId: string;
};

/** 单轮输入数据，对应一次 execution 的上下文。 */
export type ConversationTurnInput = {
  executionId: string;
  questionText: string;
  projection: AiRuntimeProjection | null;
  events: readonly AnalysisExecutionStreamEvent[];
  intentLabel?: string;
  ontologyVersion?: string;
  followUpLabel?: string;
  hasConnectionIssue?: boolean;
  planAssumptions?: readonly string[];
};

/** 构建对话线程的输入参数。 */
export type BuildConversationThreadInput = {
  rounds: ConversationTurnInput[];
  activeTurnId: string;
};

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 将多轮追问构建为线性对话线程。
 *
 * 每轮调用 buildConversationViewModel 生成独立 turn，
 * 仅 activeTurnId 对应的 turn 标记为 isExpanded（展开显示完整内容）。
 */
export function buildConversationThreadViewModel(
  input: BuildConversationThreadInput,
): ConversationThreadViewModel {
  const turns: ConversationTurn[] = input.rounds.map((round) => {
    const viewModelInput: BuildConversationViewModelInput = {
      questionText: round.questionText,
      intentLabel: round.intentLabel,
      ontologyVersion: round.ontologyVersion,
      followUpLabel: round.followUpLabel,
      projection: round.projection,
      events: round.events,
      hasConnectionIssue: round.hasConnectionIssue ?? false,
      planAssumptions: round.planAssumptions,
    };

    return {
      executionId: round.executionId,
      viewModel: buildConversationViewModel(viewModelInput),
      isExpanded: round.executionId === input.activeTurnId,
    };
  });

  return {
    turns,
    activeTurnId: input.activeTurnId,
  };
}
