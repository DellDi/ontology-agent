import type { JavaAnalysisSession } from '@/infrastructure/java-backend';
import type { ChatTurn } from './analysis-conversation-shell';

type JavaHistoryRound = JavaAnalysisSession['history'][number];

function normalizeTurnStatus(
  status: JavaHistoryRound['status'],
): ChatTurn['status'] {
  if (status === 'completed' || status === 'failed') {
    return status;
  }
  if (status === 'processing' || status === 'queued') {
    return 'running';
  }
  return 'pending';
}

/**
 * 会话页轮次构建：历史轮按执行事实静态渲染；当前执行轮标记 live 由实时投影接管；
 * 已创建但尚未产生执行的新消息作为 pending 轮追加（进入页面即自动接力执行）。
 */
export function buildChatTurns(
  aggregate: JavaAnalysisSession,
  resolvedExecutionId: string | null,
): ChatTurn[] {
  const turns: ChatTurn[] = aggregate.history.map((round) => ({
    key: round.id,
    questionText: round.questionText,
    status: normalizeTurnStatus(round.status),
    live:
      round.executionId !== null && round.executionId === resolvedExecutionId,
    followUpId: round.followUpId,
    conclusionState: round.conclusionState ?? null,
  }));

  const knownFollowUpRoundIds = new Set(
    aggregate.history.map((round) => round.followUpId).filter(Boolean),
  );
  for (const followUp of aggregate.followUps) {
    if (followUp.resultExecutionId || knownFollowUpRoundIds.has(followUp.id)) {
      continue;
    }
    turns.push({
      key: `pending-${followUp.id}`,
      questionText: followUp.questionText,
      status: 'pending',
      live: false,
      followUpId: followUp.id,
      conclusionState: null,
    });
  }

  return turns;
}
