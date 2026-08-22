import type { JavaAnalysisSession } from './read-client';

export type JavaMobileHistoryRound = {
  id: string;
  label: string;
  questionText: string;
  conclusionSummary: string | null;
  isLatest: boolean;
};

export type JavaMobileAnalysisView = {
  status: string;
  statusLabel: string;
  questionText: string;
  summary: string | null;
  updatedAt: string | null;
  executionId: string | null;
  resumeAfterSequence: number;
  evidence: { label: string; summary: string }[];
  history: JavaMobileHistoryRound[];
  activeFollowUpId: string | null;
  canCreateFollowUp: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  queued: '已排队',
  processing: '分析中',
  completed: '已完成',
  failed: '已失败',
  dead_letter: '执行已终止',
};

export function buildJavaMobileAnalysisView(
  aggregate: JavaAnalysisSession,
): JavaMobileAnalysisView {
  const snapshot = aggregate.snapshot;
  const cause = snapshot?.conclusionState.causes[0] ?? null;
  const activeRound = aggregate.history.find(
    (round) => round.executionId === aggregate.runtime.resolvedExecutionId,
  ) ?? aggregate.history.at(-1)!;
  const activeConclusion = activeRound?.conclusionState
    ?? (snapshot?.executionId === activeRound?.executionId ? snapshot.conclusionState : null);

  return {
    status: aggregate.runtime.status ?? 'pending',
    statusLabel: STATUS_LABELS[aggregate.runtime.status ?? 'pending'] ?? '状态未知',
    questionText: activeRound?.questionText ?? aggregate.session.questionText,
    summary: cause?.summary ?? null,
    updatedAt: snapshot?.updatedAt ?? null,
    executionId: aggregate.runtime.resolvedExecutionId,
    resumeAfterSequence: aggregate.runtime.resumeAfterSequence,
    evidence: cause?.evidence ?? [],
    history: aggregate.history.map((round, index) => ({
      id: round.id,
      label: round.kind === 'initial' ? '首次分析' : `追问 ${index}`,
      questionText: round.questionText,
      conclusionSummary: round.conclusionState?.causes[0]?.summary ?? null,
      isLatest: round.id === aggregate.history.at(-1)?.id,
    })),
    activeFollowUpId: activeRound?.followUpId ?? null,
    canCreateFollowUp: Boolean(
      activeRound?.status === 'completed' && activeConclusion?.causes.length,
    ),
  };
}
