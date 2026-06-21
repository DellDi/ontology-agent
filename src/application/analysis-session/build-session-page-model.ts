import type { AuthSession } from '@/domain/auth/models';
import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';
import type { CompositionRoot } from '@/composition-root';
import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { CandidateFactorReadModel } from '@/application/factor-expansion/use-cases';
import type { AnalysisPlanReadModel } from '@/application/analysis-planning/use-cases';
import type { AnalysisHistoryReadModel } from '@/application/analysis-history/use-cases';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisUiMessageProjectionHydrationResult } from '@/application/analysis-message-projection/use-cases';
import type { ConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import type { FollowUpContextChangeItem } from '@/domain/analysis-session/follow-up-models';

import { analysisHistoryUseCases } from '@/application/analysis-history/use-cases';
import { buildConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import {
  buildGroundedPlanningArtifacts,
  buildGroundingBlockedPlanReadModel,
  formatGroundingErrorForUser,
} from '@/application/ontology/grounded-planning';
import { getIntentTypeLabel } from '@/domain/analysis-intent/models';
import { resolveOntologyVersionBindingForDisplay } from '@/domain/ontology/version-binding';
import { formatOntologyVersionBindingBadge } from '@/shared/ontology/version-binding-display';
import {
  buildExecutionStreamReadModelFromSnapshot,
  getSessionScopedExecutionSnapshot,
  getSessionScopedExecutionJob,
  resolvePlanSnapshotForDisplay,
  resolveExecutionProjectionDisplaySelection,
} from '@/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display';
import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';

// ---------------------------------------------------------------------------
// Helper functions (moved from page.tsx)
// ---------------------------------------------------------------------------

function readSearchParam(
  value: string | string[] | undefined,
  fallback = '',
) {
  if (typeof value === 'string') {
    return value;
  }

  return fallback;
}

function parseFollowUpConflict(
  value: string | string[] | undefined,
) {
  const raw = readSearchParam(value);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveActiveFollowUpId(
  followUpId: string,
  followUps: AnalysisSessionFollowUp[],
) {
  if (!followUps.length) {
    return null;
  }

  return (
    followUps.find((followUp) => followUp.id === followUpId) ??
    followUps.at(-1) ??
    null
  );
}

function buildFollowUpContextReadModel(
  sessionId: string,
  followUp: AnalysisSessionFollowUp,
) {
  return {
    sessionId,
    version: 0,
    context: followUp.mergedContext,
    canUndo: false,
    originalQuestionText: followUp.questionText,
  };
}

function mergeFollowUpManualCandidateFactors(
  followUp: AnalysisSessionFollowUp | null,
  candidateFactorReadModel: CandidateFactorReadModel,
): CandidateFactorReadModel {
  if (!followUp) {
    return candidateFactorReadModel;
  }

  const manualFactors = followUp.mergedContext.constraints
    .filter((constraint) => constraint.label === '候选因素')
    .map((constraint, index) => ({
      key: `manual-factor-${index + 1}`,
      label: constraint.value,
      rationale: '用户在 follow-up 中显式补充的候选因素。',
    }));
  const manualFactorLabels = new Set(
    manualFactors.map((factor) => factor.label),
  );

  return {
    ...candidateFactorReadModel,
    factors: [
      ...manualFactors,
      ...candidateFactorReadModel.factors.filter(
        (factor) => !manualFactorLabels.has(factor.label),
      ),
    ],
  };
}

function getPlanAssumptionsFromSnapshot(
  snapshot: { planSnapshot?: { _executionAssumptions?: string[] } } | null,
) {
  return snapshot?.planSnapshot?._executionAssumptions ?? [];
}

function getConclusionCauseIdsFromSnapshot(
  snapshot: { conclusionState?: { causes?: { id: string }[] } } | null,
) {
  return snapshot?.conclusionState?.causes?.map((cause) => cause.id) ?? [];
}

type SnapshotForConclusionReadModel =
  Parameters<typeof buildExecutionStreamReadModelFromSnapshot>[0] & {
    conclusionState?: AnalysisConclusionReadModel | null;
  };

function resolveConclusionReadModelFromSnapshot(
  snapshot: SnapshotForConclusionReadModel | null,
): AnalysisConclusionReadModel | null {
  if (!snapshot) {
    return null;
  }

  const storedConclusion = snapshot.conclusionState ?? null;

  if (storedConclusion?.causes?.length) {
    return storedConclusion;
  }

  const rebuiltConclusion = buildAnalysisConclusionReadModel(
    buildExecutionStreamReadModelFromSnapshot(snapshot).events,
  );

  if (
    rebuiltConclusion.causes.length > 0 ||
    rebuiltConclusion.renderBlocks.length > 0
  ) {
    return rebuiltConclusion;
  }

  return storedConclusion;
}

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type AnalysisSessionPageInput = {
  root: CompositionRoot;
  sessionId: string;
  owner: AuthSession;
  searchParams: Record<string, string | string[] | undefined>;
};

export type FollowUpSectionModel = {
  hasInput: boolean;
  sessionId: string;
  activeFollowUpId: string | undefined;
  latestConclusionTitle: string | null;
  latestConclusionSummary: string | null;
  inheritedContext: AnalysisContext;
  followUps: AnalysisSessionFollowUp[];
  adjustmentDraft: {
    targetMetric: string;
    entity: string;
    timeRange: string;
    comparison: string;
    factor: string;
  };
  conflictItems: FollowUpContextChangeItem[];
  feedback: { tone: 'success' | 'error'; message: string } | null;
  replanFeedback: { tone: 'success' | 'error'; message: string } | null;
};

export type AnalysisSessionPageModel = {
  sessionId: string;
  questionText: string;
  ownerUserId: string;

  resolvedExecutionId: string;
  executionStreamReadModel: AnalysisExecutionStreamReadModel | null;
  liveConclusionReadModel: AnalysisConclusionReadModel | null;
  projectionHydration: AnalysisUiMessageProjectionHydrationResult | null;
  enableLiveStream: boolean;

  ontologyVersionBindingForDisplay: OntologyVersionBinding | null;
  ontologyVersionBadgeText: string | null;

  analysisPlanReadModel: AnalysisPlanReadModel;
  groundedPlanPreviewError: Error | null;
  groundedPlanPreviewErrorMessage: string | undefined;

  intentLabel: string | undefined;
  followUpLabel: string | undefined;
  activeFollowUpId: string | undefined;

  mergedCandidateFactorReadModel: CandidateFactorReadModel;
  thread: ConversationThreadViewModel | undefined;

  contextReadModel: AnalysisContextReadModel;
  historyReadModel: AnalysisHistoryReadModel;

  shouldAutoExecute: boolean;
  shouldRefreshPendingExecution: boolean;
  shouldShowExecutionFeedback: boolean;
  executionError: string;
  executionFeedbackMessage: string;
  pendingExecutionBlockerMessage: string;
  pendingExecutionHeadline: string;

  followUpSection: FollowUpSectionModel;
};

// ---------------------------------------------------------------------------
// Main use-case function
// ---------------------------------------------------------------------------

export async function buildAnalysisSessionPageModel(
  input: AnalysisSessionPageInput,
): Promise<AnalysisSessionPageModel | null> {
  const { root, sessionId, owner, searchParams } = input;

  const analysisSession = await root.analysisSessionUseCases.getOwnedSession({
    sessionId,
    owner,
  });

  if (!analysisSession) {
    return null;
  }

  const intent = await root.analysisIntentUseCases.getOrRecognizeIntent({
    sessionId: analysisSession.id,
    questionText: analysisSession.questionText,
  });

  await root.analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: owner.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const contextReadModel = await root.analysisContextUseCases.getCurrentContext({
    sessionId: analysisSession.id,
    questionText: analysisSession.questionText,
    savedContext: analysisSession.savedContext,
  });

  const executionId = readSearchParam(searchParams.executionId);
  const executionError = readSearchParam(searchParams.executionError);
  const followUpId = readSearchParam(searchParams.followUpId);
  const followUpError = readSearchParam(searchParams.followUpError);
  const followUpAdjustmentError = readSearchParam(
    searchParams.followUpAdjustmentError,
  );
  const historyRoundId = readSearchParam(searchParams.historyRoundId);
  const followUpContextUpdated = readSearchParam(
    searchParams.followUpContextUpdated,
  );
  const followUpReplanned = readSearchParam(
    searchParams.followUpReplanned,
  );
  const followUpReplanError = readSearchParam(
    searchParams.followUpReplanError,
  );
  const followUpConflictItems = parseFollowUpConflict(
    searchParams.followUpConflict,
  );
  const followUpAdjustmentDraft = {
    targetMetric: readSearchParam(searchParams.targetMetric),
    entity: readSearchParam(searchParams.entity),
    timeRange: readSearchParam(searchParams.timeRange),
    comparison: readSearchParam(searchParams.comparison),
    factor: readSearchParam(searchParams.factor),
  };

  const latestExecutionSnapshot =
    await root.analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
      sessionId: analysisSession.id,
      ownerUserId: owner.userId,
    });
  const sessionSnapshots =
    await root.analysisExecutionPersistenceUseCases.listSnapshotsForSession({
      sessionId: analysisSession.id,
      ownerUserId: owner.userId,
    });
  const followUps = await root.analysisFollowUpUseCases.listOwnedFollowUps({
    sessionId: analysisSession.id,
    ownerUserId: owner.userId,
  });

  const activeFollowUp = resolveActiveFollowUpId(followUpId, followUps);

  const historyReadModel = analysisHistoryUseCases.buildHistoryReadModel({
    session: analysisSession,
    sessionContext: contextReadModel.context,
    followUps,
    snapshots: sessionSnapshots,
    selectedRoundId: historyRoundId || null,
  });

  const planContextReadModel = activeFollowUp
    ? buildFollowUpContextReadModel(analysisSession.id, activeFollowUp)
    : contextReadModel;
  const planQuestionText =
    activeFollowUp?.questionText ?? analysisSession.questionText;

  const baseCandidateFactorReadModel =
    await root.factorExpansionUseCases.buildCandidateFactorReadModel({
      intentType: intent.type,
      questionText: analysisSession.questionText,
      contextReadModel,
    });

  const planCandidateFactorReadModel = activeFollowUp
    ? await root.factorExpansionUseCases.buildCandidateFactorReadModel({
        intentType: intent.type,
        questionText: planQuestionText,
        contextReadModel: planContextReadModel,
      })
    : baseCandidateFactorReadModel;

  const mergedCandidateFactorReadModel =
    mergeFollowUpManualCandidateFactors(
      activeFollowUp,
      planCandidateFactorReadModel,
    );

  const followUpCandidateFactorReadModels = new Map<
    string,
    CandidateFactorReadModel
  >();

  for (const followUp of followUps) {
    if (activeFollowUp?.id === followUp.id) {
      followUpCandidateFactorReadModels.set(
        followUp.id,
        mergedCandidateFactorReadModel,
      );
      continue;
    }

    const followUpCandidateFactorReadModel =
      await root.factorExpansionUseCases.buildCandidateFactorReadModel({
        intentType: intent.type,
        questionText: followUp.questionText,
        contextReadModel: buildFollowUpContextReadModel(
          analysisSession.id,
          followUp,
        ),
      });
    followUpCandidateFactorReadModels.set(
      followUp.id,
      mergeFollowUpManualCandidateFactors(
        followUp,
        followUpCandidateFactorReadModel,
      ),
    );
  }

  const requestedExecutionSnapshot = executionId
    ? await root.analysisExecutionPersistenceUseCases.getSnapshotByExecutionId({
        executionId,
        ownerUserId: owner.userId,
      })
    : null;

  const sessionScopedRequestedExecutionSnapshot =
    getSessionScopedExecutionSnapshot(
      requestedExecutionSnapshot,
      analysisSession.id,
    );

  const requestedExecutionRuntime =
    executionId && !sessionScopedRequestedExecutionSnapshot
      ? await root.withJobUseCases(async ({
          jobUseCases,
          analysisExecutionStreamUseCases,
        }) => {
          const requestedExecutionJob = getSessionScopedExecutionJob(
            await jobUseCases.getJob(executionId),
            {
              sessionId: analysisSession.id,
              ownerUserId: owner.userId,
            },
          );

          return {
            requestedExecutionJob,
            requestedExecutionStreamReadModel: requestedExecutionJob
              ? await analysisExecutionStreamUseCases.buildReadModel({
                  sessionId: analysisSession.id,
                  executionId: requestedExecutionJob.executionId,
                })
              : null,
          };
        })
      : {
          requestedExecutionJob: null,
          requestedExecutionStreamReadModel: null,
        };

  const requestedExecutionIdForDisplay =
    sessionScopedRequestedExecutionSnapshot?.executionId ??
    requestedExecutionRuntime.requestedExecutionJob?.executionId ??
    '';

  const projectionDisplaySelection = resolveExecutionProjectionDisplaySelection({
    requestedExecutionIdForDisplay,
    sessionScopedRequestedExecutionSnapshot,
    latestExecutionSnapshot,
    sessionSnapshots,
    selectedHistoryRound: historyRoundId
      ? historyReadModel.selectedRound
      : null,
  });

  const snapshotForDisplay = projectionDisplaySelection.snapshotForDisplay;
  const planSnapshotForDisplay = resolvePlanSnapshotForDisplay({
    sessionScopedRequestedExecutionSnapshot,
    requestedExecutionJob: requestedExecutionRuntime.requestedExecutionJob,
    activeFollowUpPlanSnapshot: activeFollowUp?.currentPlanSnapshot ?? null,
    snapshotForDisplay,
    isHistoryReplay: projectionDisplaySelection.isHistoryReplay,
  });

  let groundedPlanPreviewError: Error | null = null;
  let groundedPlanPreviewSnapshot = planSnapshotForDisplay;

  if (!groundedPlanPreviewSnapshot) {
    try {
      groundedPlanPreviewSnapshot = (
        await buildGroundedPlanningArtifacts({
          sessionId: analysisSession.id,
          ownerUserId: owner.userId,
          intentType: intent.type,
          contextReadModel: planContextReadModel,
          candidateFactorReadModel: mergedCandidateFactorReadModel,
          groundingUseCases: root.ontologyRuntimeServices.groundingUseCases,
          analysisPlanningUseCases: root.analysisPlanningUseCases,
        })
      ).planSnapshot;
    } catch (error) {
      groundedPlanPreviewError =
        error instanceof Error
          ? error
          : new Error('治理化计划预览生成失败。');
    }
  }

  const analysisPlanReadModel = groundedPlanPreviewSnapshot
    ? root.analysisPlanningUseCases.buildPlanReadModelFromSnapshot({
        planSnapshot: groundedPlanPreviewSnapshot,
      })
    : buildGroundingBlockedPlanReadModel(
        groundedPlanPreviewError ?? new Error('治理化计划预览生成失败。'),
      );

  const resolvedExecutionId = projectionDisplaySelection.resolvedExecutionId;
  const executionStreamReadModel = sessionScopedRequestedExecutionSnapshot
    ? buildExecutionStreamReadModelFromSnapshot(
        sessionScopedRequestedExecutionSnapshot,
      )
    : requestedExecutionRuntime.requestedExecutionStreamReadModel ??
      (snapshotForDisplay
        ? buildExecutionStreamReadModelFromSnapshot(snapshotForDisplay)
        : null);

  const conclusionReadModel =
    resolveConclusionReadModelFromSnapshot(sessionScopedRequestedExecutionSnapshot) ??
    resolveConclusionReadModelFromSnapshot(snapshotForDisplay);
  const liveConclusionReadModel = conclusionReadModel
    ? conclusionReadModel
    : executionStreamReadModel
      ? buildAnalysisConclusionReadModel(executionStreamReadModel.events)
      : null;

  const projectionHydration =
    resolvedExecutionId && executionStreamReadModel
      ? await root.analysisUiMessageProjectionUseCases.hydrateProjection({
          ownerUserId: owner.userId,
          sessionId: analysisSession.id,
          executionId: resolvedExecutionId,
          followUpId: projectionDisplaySelection.followUpIdForProjection,
          historyRoundId: projectionDisplaySelection.historyRoundIdForProjection,
          canonical: {
            events: executionStreamReadModel.events,
            fallbackConclusion: liveConclusionReadModel,
          },
        })
      : null;

  const ontologyVersionBindingForDisplay =
    resolveOntologyVersionBindingForDisplay({
      snapshotBinding: snapshotForDisplay?.ontologyVersionBinding ?? null,
      followUpBinding: activeFollowUp?.ontologyVersionBinding ?? null,
    });
  const ontologyVersionBadgeText = ontologyVersionBindingForDisplay
    ? formatOntologyVersionBindingBadge(ontologyVersionBindingForDisplay)
    : null;

  const latestExecutionConclusionReadModel =
    resolveConclusionReadModelFromSnapshot(latestExecutionSnapshot);
  const latestFollowUpConclusion = activeFollowUp
    ? {
        title: activeFollowUp.referencedConclusionTitle,
        summary: activeFollowUp.referencedConclusionSummary,
      }
    : (latestExecutionConclusionReadModel?.causes?.[0] ?? null);

  const followUpInheritedContext = activeFollowUp?.mergedContext ?? contextReadModel.context;

  const followUpFeedback = followUpError
    ? {
        tone: 'error' as const,
        message: followUpError,
      }
    : followUpAdjustmentError
      ? {
          tone: 'error' as const,
          message: followUpAdjustmentError,
        }
      : followUpContextUpdated === 'conflict-confirmed'
        ? {
            tone: 'success' as const,
            message: '冲突条件已确认并更新到当前轮次上下文。',
          }
        : followUpContextUpdated
          ? {
              tone: 'success' as const,
              message: '当前轮次上下文已合并新增条件。',
            }
          : null;

  const followUpCreationFeedback =
    !followUpFeedback &&
    followUpId &&
    followUps.some((followUp) => followUp.id === followUpId)
      ? {
          tone: 'success' as const,
          message: '追问已附着到当前会话，可继续基于既有结论向下钻取。',
        }
      : null;

  const followUpReplanFeedback = followUpReplanError
    ? {
        tone: 'error' as const,
        message: followUpReplanError,
      }
    : followUpReplanned
      ? {
          tone: 'success' as const,
          message: '已根据纠正后的上下文重生成后续计划。',
        }
      : null;

  const hasSessionExecution = Boolean(latestExecutionSnapshot);
  const hasActiveFollowUpExecution = Boolean(activeFollowUp?.resultExecutionId);
  const shouldAutoExecuteBase =
    !requestedExecutionIdForDisplay &&
    !executionError &&
    !groundedPlanPreviewError &&
    (!activeFollowUp ? !hasSessionExecution : !hasActiveFollowUpExecution);
  const shouldAutoExecuteAfterReplan =
    Boolean(activeFollowUp) &&
    Boolean(followUpReplanned) &&
    !followUpReplanError &&
    !requestedExecutionIdForDisplay &&
    !executionError &&
    !groundedPlanPreviewError;
  const shouldAutoExecute = shouldAutoExecuteBase || shouldAutoExecuteAfterReplan;

  const pendingExecutionBlockerMessage =
    executionError ||
    (groundedPlanPreviewError
      ? formatGroundingErrorForUser(groundedPlanPreviewError)
      : '');
  const pendingExecutionHeadline = pendingExecutionBlockerMessage
    ? '当前问题暂未进入执行'
    : shouldAutoExecute
      ? '正在提交执行任务'
      : '等待执行开始';

  const shouldRefreshPendingExecution =
    !executionStreamReadModel &&
    !pendingExecutionBlockerMessage &&
    (shouldAutoExecute || Boolean(requestedExecutionIdForDisplay) || !latestExecutionSnapshot);

  const executionFeedbackStatus =
    executionStreamReadModel?.currentStatus ??
    requestedExecutionRuntime.requestedExecutionJob?.status ??
    sessionScopedRequestedExecutionSnapshot?.status ??
    null;
  const shouldShowExecutionFeedback =
    Boolean(executionError) ||
    (Boolean(requestedExecutionIdForDisplay) &&
      !executionStreamReadModel &&
      executionFeedbackStatus !== 'completed');
  const executionFeedbackMessage =
    executionFeedbackStatus === 'failed'
      ? '分析执行失败，请查看详细信息定位原因。'
      : executionFeedbackStatus === 'processing'
        ? '分析正在执行，结果会自动刷新。'
        : '分析已提交，正在排队处理。';

  // 构建多轮追问线程视图
  const threadRounds: Parameters<typeof buildConversationThreadViewModel>[0]['rounds'] = [];

  const followUpResultExecutionIds = new Set(
    followUps
      .map((followUp) => followUp.resultExecutionId)
      .filter((id): id is string => Boolean(id)),
  );
  const initialExecutionSnapshot =
    sessionSnapshots.find(
      (snapshot) => !followUpResultExecutionIds.has(snapshot.executionId),
    ) ?? null;

  const threadExecutionIds = new Set<string>();
  if (initialExecutionSnapshot) {
    threadExecutionIds.add(initialExecutionSnapshot.executionId);
  }
  for (const followUp of followUps) {
    if (
      followUp.resultExecutionId &&
      sessionSnapshots.some(
        (snapshot) => snapshot.executionId === followUp.resultExecutionId,
      )
    ) {
      threadExecutionIds.add(followUp.resultExecutionId);
    }
  }

  const threadExecutionData = new Map<
    string,
    {
      projection: Parameters<typeof buildConversationThreadViewModel>[0]['rounds'][number]['projection'];
      events: Parameters<typeof buildConversationThreadViewModel>[0]['rounds'][number]['events'];
    }
  >();

  for (const threadExecutionId of threadExecutionIds) {
    if (threadExecutionId === resolvedExecutionId) {
      threadExecutionData.set(threadExecutionId, {
        projection: projectionHydration?.projection ?? null,
        events: executionStreamReadModel?.events ?? [],
      });
      continue;
    }

    const threadSnapshot = sessionSnapshots.find(
      (snapshot) => snapshot.executionId === threadExecutionId,
    );

    if (!threadSnapshot) {
      threadExecutionData.set(threadExecutionId, {
        projection: null,
        events: [],
      });
      continue;
    }

    const threadStreamReadModel =
      buildExecutionStreamReadModelFromSnapshot(threadSnapshot);
    const threadHydration =
      await root.analysisUiMessageProjectionUseCases.hydrateProjection({
        ownerUserId: owner.userId,
        sessionId: analysisSession.id,
        executionId: threadExecutionId,
        followUpId: threadSnapshot.followUpId,
        canonical: {
          events: threadStreamReadModel.events,
        },
      });

    threadExecutionData.set(threadExecutionId, {
      projection: threadHydration?.projection ?? null,
      events: threadStreamReadModel.events,
    });
  }

  if (initialExecutionSnapshot) {
    const initialData = threadExecutionData.get(
      initialExecutionSnapshot.executionId,
    );
    threadRounds.push({
      executionId: initialExecutionSnapshot.executionId,
      questionText: analysisSession.questionText,
      projection: initialData?.projection ?? null,
      events: initialData?.events ?? [],
      intentLabel: intent ? getIntentTypeLabel(intent.type) : undefined,
      ontologyVersion: ontologyVersionBadgeText ?? undefined,
      candidateFactors: baseCandidateFactorReadModel.factors,
      conclusionCauseIds: getConclusionCauseIdsFromSnapshot(
        initialExecutionSnapshot,
      ),
      planAssumptions: getPlanAssumptionsFromSnapshot(
        initialExecutionSnapshot,
      ),
    });
  }

  for (const followUp of followUps) {
    const followUpSnapshot = followUp.resultExecutionId
      ? sessionSnapshots.find(
          (snapshot) => snapshot.executionId === followUp.resultExecutionId,
        )
      : null;
    if (followUpSnapshot) {
      const followUpData = threadExecutionData.get(
        followUpSnapshot.executionId,
      );
      threadRounds.push({
        executionId: followUpSnapshot.executionId,
        questionText: followUp.questionText,
        projection: followUpData?.projection ?? null,
        events: followUpData?.events ?? [],
        followUpLabel: '追问',
        candidateFactors:
          followUpCandidateFactorReadModels.get(followUp.id)?.factors ?? [],
        conclusionCauseIds: getConclusionCauseIdsFromSnapshot(followUpSnapshot),
        planAssumptions: getPlanAssumptionsFromSnapshot(followUpSnapshot),
      });
    }
  }

  const thread =
    threadRounds.length > 1
      ? buildConversationThreadViewModel({
          rounds: threadRounds,
          activeTurnId:
            resolvedExecutionId ??
            threadRounds[threadRounds.length - 1].executionId,
        })
      : undefined;

  const followUpSection: FollowUpSectionModel = {
    hasInput: Boolean(latestFollowUpConclusion),
    sessionId: analysisSession.id,
    activeFollowUpId: activeFollowUp?.id ?? undefined,
    latestConclusionTitle: latestFollowUpConclusion?.title ?? null,
    latestConclusionSummary: latestFollowUpConclusion?.summary ?? null,
    inheritedContext: followUpInheritedContext,
    followUps,
    adjustmentDraft: followUpAdjustmentDraft,
    conflictItems: followUpConflictItems,
    feedback: followUpFeedback ?? followUpCreationFeedback,
    replanFeedback: followUpReplanFeedback,
  };

  return {
    sessionId: analysisSession.id,
    questionText: analysisSession.questionText,
    ownerUserId: owner.userId,

    resolvedExecutionId,
    executionStreamReadModel,
    liveConclusionReadModel,
    projectionHydration,
    enableLiveStream: projectionDisplaySelection.enableLiveStream,

    ontologyVersionBindingForDisplay,
    ontologyVersionBadgeText,

    analysisPlanReadModel,
    groundedPlanPreviewError,
    groundedPlanPreviewErrorMessage: groundedPlanPreviewError
      ? formatGroundingErrorForUser(groundedPlanPreviewError)
      : undefined,

    intentLabel: intent ? getIntentTypeLabel(intent.type) : undefined,
    followUpLabel: activeFollowUp ? '追问模式' : undefined,
    activeFollowUpId: activeFollowUp?.id ?? undefined,

    mergedCandidateFactorReadModel,
    thread,

    contextReadModel,
    historyReadModel,

    shouldAutoExecute,
    shouldRefreshPendingExecution,
    shouldShowExecutionFeedback,
    executionError,
    executionFeedbackMessage,
    pendingExecutionBlockerMessage,
    pendingExecutionHeadline,

    followUpSection,
  };
}
