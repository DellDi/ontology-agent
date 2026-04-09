import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';
import type { AnalysisSession } from '@/domain/analysis-session/models';

type ContextSummarySource = {
  targetMetric: { value: string };
  entity: { value: string };
  timeRange: { value: string };
};

export type AnalysisHistoryRoundReadModel = {
  id: string;
  kind: 'initial' | 'follow-up';
  label: string;
  questionText: string;
  createdAt: string;
  followUpId: string | null;
  executionId: string | null;
  status: string;
  inputSummary: string[];
  planSummary: string | null;
  planSteps: Array<{
    order: number;
    title: string;
  }>;
  conclusionTitle: string | null;
  conclusionSummary: string | null;
  evidence: Array<{
    label: string;
    summary: string;
  }>;
  isLatest: boolean;
};

export type AnalysisHistoryReadModel = {
  rounds: AnalysisHistoryRoundReadModel[];
  selectedRound: AnalysisHistoryRoundReadModel | null;
  latestRoundId: string | null;
};

function buildContextSummary(context: ContextSummarySource) {
  return [
    `指标：${context.targetMetric.value}`,
    `实体：${context.entity.value}`,
    `时间：${context.timeRange.value}`,
  ];
}

function buildRound(input: {
  id: string;
  kind: 'initial' | 'follow-up';
  label: string;
  questionText: string;
  createdAt: string;
  followUpId: string | null;
  snapshot: AnalysisExecutionSnapshot | null;
  inputSummary: string[];
}): AnalysisHistoryRoundReadModel {
  const cause = input.snapshot?.conclusionState.causes?.[0] ?? null;

  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    questionText: input.questionText,
    createdAt: input.createdAt,
    followUpId: input.followUpId,
    executionId: input.snapshot?.executionId ?? null,
    status: input.snapshot?.status ?? 'pending',
    inputSummary: input.inputSummary,
    planSummary: input.snapshot?.planSnapshot.summary ?? null,
    planSteps:
      input.snapshot?.planSnapshot.steps.map((step) => ({
        order: step.order,
        title: step.title,
      })) ?? [],
    conclusionTitle: cause?.title ?? null,
    conclusionSummary: cause?.summary ?? null,
    evidence: cause?.evidence ?? [],
    isLatest: false,
  };
}

export function createAnalysisHistoryUseCases() {
  return {
    buildHistoryReadModel(input: {
      session: AnalysisSession;
      sessionContext: ContextSummarySource;
      followUps: AnalysisSessionFollowUp[];
      snapshots: AnalysisExecutionSnapshot[];
      selectedRoundId?: string | null;
    }): AnalysisHistoryReadModel {
      const snapshotByExecutionId = new Map(
        input.snapshots.map((snapshot) => [snapshot.executionId, snapshot]),
      );
      const snapshotByFollowUpId = new Map(
        input.snapshots
          .filter((snapshot) => snapshot.followUpId)
          .map((snapshot) => [snapshot.followUpId as string, snapshot]),
      );
      const rootSnapshot =
        input.snapshots.find((snapshot) => snapshot.followUpId === null) ??
        (input.followUps[0]?.referencedExecutionId
          ? (snapshotByExecutionId.get(input.followUps[0].referencedExecutionId) ??
            null)
          : null) ??
        null;
      const rounds: AnalysisHistoryRoundReadModel[] = [
        buildRound({
          id: 'session-root',
          kind: 'initial',
          label: '初始分析',
          questionText: input.session.questionText,
          createdAt: input.session.createdAt,
          followUpId: null,
          snapshot: rootSnapshot,
          inputSummary: buildContextSummary(input.sessionContext),
        }),
      ];

      input.followUps.forEach((followUp, index) => {
        rounds.push(
          buildRound({
            id: followUp.id,
            kind: 'follow-up',
            label: `第 ${index + 1} 轮追问`,
            questionText: followUp.questionText,
            createdAt: followUp.createdAt,
            followUpId: followUp.id,
            snapshot:
              (followUp.resultExecutionId
                ? (snapshotByExecutionId.get(followUp.resultExecutionId) ?? null)
                : null) ??
              snapshotByFollowUpId.get(followUp.id) ??
              null,
            inputSummary: buildContextSummary(followUp.mergedContext),
          }),
        );
      });

      const latestRoundId = rounds.at(-1)?.id ?? null;
      const roundsWithLatestFlag = rounds.map((round) => ({
        ...round,
        isLatest: round.id === latestRoundId,
      }));
      const selectedRound =
        roundsWithLatestFlag.find((round) => round.id === input.selectedRoundId) ??
        roundsWithLatestFlag.at(-1) ??
        null;

      return {
        rounds: roundsWithLatestFlag,
        selectedRound,
        latestRoundId,
      };
    },
  };
}

export const analysisHistoryUseCases = createAnalysisHistoryUseCases();
