import type { JavaAnalysisSession } from '@/infrastructure/java-backend';
import {
  resolvedQueryIntents,
  type ResolvedQueryIntent,
  type SemanticClarification,
  type SemanticEditorCatalog,
  type SemanticQueryUnderstanding,
} from '@/application/analysis-message-projection/semantic-understanding';
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

function roundMetadata(round: JavaHistoryRound, followUp?: JavaAnalysisSession["followUps"][number]): {
  understanding: SemanticQueryUnderstanding[] | null;
  editorCatalog: SemanticEditorCatalog | null;
  clarification: SemanticClarification | null;
  resolvedQueries: ResolvedQueryIntent[];
  objectSelection?: ChatTurn["objectSelection"];
  objectSelectionLabel?: string;
} {
  const plan = round.planSnapshot;
  const selection = plan?._objectSelection ?? followUp?.mergedContext?.objectSelection;
  return {
    ...(selection ? { objectSelection: { ...selection,
      executionId: round.status === 'completed' && round.executionId ? round.executionId : selection.executionId },
      objectSelectionLabel: plan?._objectSelectionLabel ?? selection.reference.objectId } : {}),
    understanding: plan?._understanding ?? null,
    editorCatalog: plan?._editorCatalog ?? null,
    clarification: plan?._clarification ?? null,
    resolvedQueries: resolvedQueryIntents(plan?._resolvedContext),
  };
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
    executionId: round.executionId,
    kind: round.kind,
    questionText: round.questionText,
    status: normalizeTurnStatus(round.status),
    live:
      round.executionId !== null && round.executionId === resolvedExecutionId,
    followUpId: round.followUpId,
    conclusionState: round.conclusionState ?? null,
    ...roundMetadata(round, aggregate.followUps.find((item) => item.id === round.followUpId)),
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
      kind: 'follow-up',
      questionText: followUp.questionText,
      status: 'pending',
      live: false,
      followUpId: followUp.id,
      conclusionState: null,
      understanding: null,
      editorCatalog: null,
      clarification: null,
      resolvedQueries: [],
      ...(followUp.mergedContext?.objectSelection ? {objectSelection: followUp.mergedContext.objectSelection,
        objectSelectionLabel: followUp.mergedContext.objectSelection.reference.objectId} : {}),
    });
  }

  return turns;
}
