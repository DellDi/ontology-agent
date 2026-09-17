import {
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
  type AnalysisRenderedBlock,
} from '@/application/analysis-interaction';
import {
  extractBusinessViews,
  type ConversationDiagnostics,
} from '@/application/analysis-message-projection/conversation-view-model';

import type { ChatTurn } from './analysis-conversation-shell';

const EMPTY_DIAGNOSTICS: ConversationDiagnostics = {
  eventCount: 0,
  lastSequence: 0,
  timelineBlocks: [],
  processBoardBlocks: [],
  renderErrors: [],
  otherBlocks: [],
  candidateValidation: {
    validations: [],
    totalFactors: 0,
    supportedCount: 0,
    notSupportedCount: 0,
    includedCount: 0,
  },
};

/**
 * 历史完成/失败轮 → 与 live 视图模型同构的渲染 props。
 * 统一走 AnalysisAssistantMessage 组件树，保证路由切换（live→static）时
 * React 按同类型组件 reconcile 而非卸载重挂载——否则图表会闪烁重绘。
 */
export function buildStaticAssistantProps(turn: ChatTurn) {
  const status = turn.status === 'failed' ? ('failed' as const) : ('completed' as const);
  const blocks: AnalysisRenderedBlock[] = [];
  for (const [index, block] of (
    turn.conclusionState?.renderBlocks ?? []
  ).entries()) {
    try {
      const part = normalizeExecutionRenderBlock(block, {
        sourceType: 'conclusion-read-model',
        blockIndex: index,
      });
      blocks.push(
        renderAnalysisInteractionPart(part, { surface: 'workspace' }),
      );
    } catch {
      // 单块失败不拖垮整条历史消息——块级渲染失败静默跳过，
      // 归因/明细仍可从结构化结论恢复。
    }
  }
  const { metricCards, visualizations } = extractBusinessViews(blocks);
  return {
    status,
    headline: status === 'completed' ? '分析完成' : '分析过程中遇到问题',
    errorSummary:
      status === 'failed'
        ? '本轮分析未能完成，可以换个问法再试一次。'
        : undefined,
    toolActivities: [],
    result: blocks.length
      ? {
          blocks,
          evidenceBlocks: [],
          reasoningBlocks: [],
          assumptionBlocks: [],
        }
      : null,
    diagnostics: EMPTY_DIAGNOSTICS,
    primaryAnswer: turn.conclusionState?.causes?.[0]?.summary ?? '',
    metricCards,
    visualizations,
    toolTimeline: [],
  };
}
