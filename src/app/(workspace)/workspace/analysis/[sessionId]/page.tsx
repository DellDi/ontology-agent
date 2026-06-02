import { notFound } from 'next/navigation';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import { createAnalysisUiMessageProjectionUseCases } from '@/application/analysis-message-projection/use-cases';
import { analysisHistoryUseCases } from '@/application/analysis-history/use-cases';
import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import {
  buildGroundedPlanningArtifacts,
  buildGroundingBlockedPlanReadModel,
  formatGroundingErrorForUser,
} from '@/application/ontology/grounded-planning';
import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';
import { resolveOntologyVersionBindingForDisplay } from '@/domain/ontology/version-binding';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisUiMessageProjectionStore } from '@/infrastructure/analysis-message-projection/postgres-analysis-ui-message-projection-store';
import { analysisIntentUseCases } from '@/infrastructure/analysis-intent';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { createOntologyRuntimeServices } from '@/infrastructure/ontology/runtime';
import { analysisPlanningUseCases } from '@/infrastructure/analysis-planning';
import { getIntentTypeLabel } from '@/domain/analysis-intent/models';
import { factorExpansionUseCases } from '@/infrastructure/factor-expansion';
import { requireWorkspaceSession } from '@/infrastructure/session/server-auth';
import { buildConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import { AnalysisContextPanel } from './_components/analysis-context-panel';
import { AnalysisExecutionLiveShell } from './_components/analysis-execution-live-shell';
import { AnalysisFollowUpPanel } from './_components/analysis-follow-up-panel';
import { AnalysisFollowUpInput } from './_components/analysis-follow-up-input';
import { AnalysisHistoryPanel } from './_components/analysis-history-panel';
import { AnalysisPlanPanel } from './_components/analysis-plan-panel';
import { AnalysisPendingRefreshGate } from './_components/analysis-pending-refresh-gate';
import { AnalysisAutoExecuteGate } from './_components/analysis-auto-execute-gate';
import { CandidateFactorPanel } from './_components/candidate-factor-panel';
import { withJobUseCases } from '@/infrastructure/job/runtime';
import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import {
  buildExecutionStreamReadModelFromSnapshot,
  getSessionScopedExecutionJob,
  getSessionScopedExecutionSnapshot,
  resolvePlanSnapshotForDisplay,
  resolveExecutionProjectionDisplaySelection,
} from './analysis-execution-display';
import { formatOntologyVersionBindingBadge } from '@/shared/ontology/version-binding-display';

type AnalysisSessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const ontologyRuntimeServices = createOntologyRuntimeServices();
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    ontologyVersionStore: ontologyRuntimeServices.versionStore,
  });
const analysisUiMessageProjectionUseCases =
  createAnalysisUiMessageProjectionUseCases({
    projectionStore: createPostgresAnalysisUiMessageProjectionStore(),
  });
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
  ontologyVersionStore: ontologyRuntimeServices.versionStore,
});

export default async function AnalysisSessionPage({
  params,
  searchParams,
}: AnalysisSessionPageProps) {
  const { sessionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const { session: currentUser, accessDeniedMessage } =
    await requireWorkspaceSession(`/workspace/analysis/${sessionId}`);

  if (accessDeniedMessage) {
    return null;
  }

  const analysisSession = await analysisSessionUseCases.getOwnedSession({
    sessionId,
    owner: currentUser,
  });

  if (!analysisSession) {
    notFound();
  }

  const intent = await analysisIntentUseCases.getIntentBySessionId(
    analysisSession.id,
  );

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: currentUser.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const contextReadModel = await analysisContextUseCases.getCurrentContext({
    sessionId: analysisSession.id,
    questionText: analysisSession.questionText,
    savedContext: analysisSession.savedContext,
  });
  const executionId = readSearchParam(resolvedSearchParams.executionId);
  const executionError = readSearchParam(
    resolvedSearchParams.executionError,
  );
  const followUpId = readSearchParam(resolvedSearchParams.followUpId);
  const followUpError = readSearchParam(resolvedSearchParams.followUpError);
  const followUpAdjustmentError = readSearchParam(
    resolvedSearchParams.followUpAdjustmentError,
  );
  const historyRoundId = readSearchParam(resolvedSearchParams.historyRoundId);
  const followUpContextUpdated = readSearchParam(
    resolvedSearchParams.followUpContextUpdated,
  );
  const followUpReplanned = readSearchParam(
    resolvedSearchParams.followUpReplanned,
  );
  const followUpReplanError = readSearchParam(
    resolvedSearchParams.followUpReplanError,
  );
  const followUpConflictItems = parseFollowUpConflict(
    resolvedSearchParams.followUpConflict,
  );
  const followUpAdjustmentDraft = {
    targetMetric: readSearchParam(resolvedSearchParams.targetMetric),
    entity: readSearchParam(resolvedSearchParams.entity),
    timeRange: readSearchParam(resolvedSearchParams.timeRange),
    comparison: readSearchParam(resolvedSearchParams.comparison),
    factor: readSearchParam(resolvedSearchParams.factor),
  };
  const latestExecutionSnapshot =
    await analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
      sessionId: analysisSession.id,
      ownerUserId: currentUser.userId,
    });
  const sessionSnapshots =
    await analysisExecutionPersistenceUseCases.listSnapshotsForSession({
      sessionId: analysisSession.id,
      ownerUserId: currentUser.userId,
    });
  const followUps = await analysisFollowUpUseCases.listOwnedFollowUps({
    sessionId: analysisSession.id,
    ownerUserId: currentUser.userId,
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
    ? {
        sessionId: analysisSession.id,
        version: 0,
        context: activeFollowUp.mergedContext,
        canUndo: false,
        originalQuestionText: activeFollowUp.questionText,
      }
    : contextReadModel;
  const planQuestionText =
    activeFollowUp?.questionText ?? analysisSession.questionText;
  const candidateFactorReadModel =
    await factorExpansionUseCases.buildCandidateFactorReadModel({
      intentType: intent?.type ?? 'general-analysis',
      questionText: planQuestionText,
      contextReadModel: planContextReadModel,
    });
  const mergedCandidateFactorReadModel = activeFollowUp
    ? {
        ...candidateFactorReadModel,
        factors: [
          ...(activeFollowUp.mergedContext.constraints
            .filter((constraint) => constraint.label === '候选因素')
            .map((constraint, index) => ({
              key: `manual-factor-${index + 1}`,
              label: constraint.value,
              rationale: '用户在 follow-up 中显式补充的候选因素。',
            }))),
          ...candidateFactorReadModel.factors.filter(
            (factor) =>
              !activeFollowUp.mergedContext.constraints.some(
                (constraint) =>
                  constraint.label === '候选因素' &&
                  constraint.value === factor.label,
              ),
          ),
        ],
      }
    : candidateFactorReadModel;
  const requestedExecutionSnapshot = executionId
    ? await analysisExecutionPersistenceUseCases.getSnapshotByExecutionId({
        executionId,
        ownerUserId: currentUser.userId,
      })
    : null;
  const sessionScopedRequestedExecutionSnapshot =
    getSessionScopedExecutionSnapshot(
      requestedExecutionSnapshot,
      analysisSession.id,
    );
  const requestedExecutionRuntime =
    executionId && !sessionScopedRequestedExecutionSnapshot
      ? await withJobUseCases(async ({
          jobUseCases,
          analysisExecutionStreamUseCases,
        }) => {
          const requestedExecutionJob = getSessionScopedExecutionJob(
            await jobUseCases.getJob(executionId),
            {
              sessionId: analysisSession.id,
              ownerUserId: currentUser.userId,
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
          ownerUserId: currentUser.userId,
          intentType: intent?.type ?? 'general-analysis',
          contextReadModel: planContextReadModel,
          candidateFactorReadModel: mergedCandidateFactorReadModel,
          groundingUseCases: ontologyRuntimeServices.groundingUseCases,
          analysisPlanningUseCases,
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
    ? analysisPlanningUseCases.buildPlanReadModelFromSnapshot({
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
    sessionScopedRequestedExecutionSnapshot?.conclusionState ??
    snapshotForDisplay?.conclusionState ??
    null;
  const liveConclusionReadModel = conclusionReadModel
    ? conclusionReadModel
    : executionStreamReadModel
      ? buildAnalysisConclusionReadModel(executionStreamReadModel.events)
      : null;
  const projectionHydration =
    resolvedExecutionId && executionStreamReadModel
      ? await analysisUiMessageProjectionUseCases.hydrateProjection({
          ownerUserId: currentUser.userId,
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
  const latestFollowUpConclusion = activeFollowUp
    ? {
        title: activeFollowUp.referencedConclusionTitle,
        summary: activeFollowUp.referencedConclusionSummary,
      }
    : (latestExecutionSnapshot?.conclusionState?.causes?.[0] ?? null);
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
  // 构建多轮追问线程视图（2+ 轮时传递给 live shell，否则退化为单轮模式）
  const threadRounds: Parameters<typeof buildConversationThreadViewModel>[0]['rounds'] = [];

  // 初始执行快照：不被任何 followUp.resultExecutionId 引用的快照（根轮次绑定初始执行，而非最新执行）
  const followUpResultExecutionIds = new Set(
    followUps
      .map((followUp) => followUp.resultExecutionId)
      .filter((id): id is string => Boolean(id)),
  );
  const initialExecutionSnapshot =
    sessionSnapshots.find(
      (snapshot) => !followUpResultExecutionIds.has(snapshot.executionId),
    ) ?? null;

  // 收集线程中所有轮次的 executionId，逐轮加载各自的事实（projection + events），
  // 避免将当前正在查看的执行错挂到其他轮次上。
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
      // 复用当前已加载的 read model / projection，避免重复 IO
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
      await analysisUiMessageProjectionUseCases.hydrateProjection({
        ownerUserId: currentUser.userId,
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

  // 初始轮次（session 本身）
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
    });
  }

  // 追问轮次：通过 resultExecutionId 在 sessionSnapshots 中查找对应快照
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

  const followUpInputBlock = latestFollowUpConclusion ? (
    <AnalysisFollowUpInput
      sessionId={analysisSession.id}
      activeFollowUpId={activeFollowUp?.id}
      drawerContent={
        <AnalysisFollowUpPanel
          sessionId={analysisSession.id}
          activeFollowUpId={activeFollowUp?.id}
          latestConclusionTitle={latestFollowUpConclusion.title}
          latestConclusionSummary={latestFollowUpConclusion.summary}
          inheritedContext={followUpInheritedContext}
          followUps={followUps}
          adjustmentDraft={followUpAdjustmentDraft}
          conflictItems={followUpConflictItems}
          feedback={followUpFeedback ?? followUpCreationFeedback}
          replanFeedback={followUpReplanFeedback}
        />
      }
    />
  ) : null;

  return (
    <section className="mx-auto w-full max-w-[920px] space-y-6 px-2">
      {/* 自动执行 gate */}
      <AnalysisAutoExecuteGate
        sessionId={analysisSession.id}
        followUpId={activeFollowUp?.id}
        enabled={shouldAutoExecute}
      />
      <AnalysisPendingRefreshGate enabled={shouldRefreshPendingExecution} />

      {/* 执行提交反馈（轻量 banner） */}
      {(requestedExecutionIdForDisplay || executionError) ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          data-testid="analysis-execution-feedback"
          style={{
            backgroundColor: executionError
              ? 'rgb(255 106 106 / 10%)'
              : 'rgb(49 185 130 / 10%)',
            color: executionError
              ? 'rgb(159 57 57)'
              : 'rgb(18 96 69)',
          }}
        >
          {executionError ? (
            <p>{executionError}</p>
          ) : (
            <p>执行任务已提交，正在等待处理结果。</p>
          )}
        </div>
      ) : null}

      {/* 主聊天窗口 */}
      {resolvedExecutionId && executionStreamReadModel ? (
        <AnalysisExecutionLiveShell
          sessionId={analysisSession.id}
          executionId={resolvedExecutionId}
          ownerUserId={currentUser.userId}
          initialReadModel={executionStreamReadModel}
          initialConclusionReadModel={liveConclusionReadModel}
          initialProjection={projectionHydration?.projection ?? null}
          resumeCursor={projectionHydration?.resumeCursor ?? null}
          enableLiveStream={projectionDisplaySelection.enableLiveStream}
          ontologyVersionBinding={ontologyVersionBindingForDisplay}
          planAssumptions={analysisPlanReadModel.assumptions}
          questionText={analysisSession.questionText}
          intentLabel={intent ? getIntentTypeLabel(intent.type) : undefined}
          ontologyVersionBadge={ontologyVersionBadgeText ?? undefined}
          followUpLabel={activeFollowUp ? '追问模式' : undefined}
          candidateFactors={mergedCandidateFactorReadModel.factors}
          thread={thread}
          drawerContents={{
            plan: (
              <AnalysisPlanPanel
                sessionId={analysisSession.id}
                readModel={analysisPlanReadModel}
                followUpId={activeFollowUp?.id}
                blockingMessage={
                  groundedPlanPreviewError
                    ? formatGroundingErrorForUser(groundedPlanPreviewError)
                    : undefined
                }
              />
            ),
            context: (
              <AnalysisContextPanel
                sessionId={analysisSession.id}
                initialReadModel={contextReadModel}
              />
            ),
            history: (
              <AnalysisHistoryPanel
                sessionId={analysisSession.id}
                activeFollowUpId={activeFollowUp?.id}
                readModel={historyReadModel}
              />
            ),
            candidates: (
              <CandidateFactorPanel readModel={mergedCandidateFactorReadModel} />
            ),
          }}
        >
          {followUpInputBlock}
        </AnalysisExecutionLiveShell>
      ) : (
        /* 无执行时的静态会话展示 */
        <div
          className="mx-auto w-full max-w-[860px] space-y-6 px-4"
          data-testid="analysis-pending-conversation"
        >
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[color:var(--brand-700)] px-5 py-3.5">
              <p className="text-base leading-7 text-white">
                {analysisSession.questionText}
              </p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="w-full max-w-[90%]">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-2.5 w-2.5 rounded-full ${
                    pendingExecutionBlockerMessage
                      ? 'bg-rose-400'
                      : 'bg-[color:var(--ink-600)]/30'
                  }`}
                />
                <p className="text-sm font-medium text-[color:var(--ink-900)]">
                  {pendingExecutionHeadline}
                </p>
              </div>

              {pendingExecutionBlockerMessage ? (
                <div
                  className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
                  data-testid="analysis-execution-blocked"
                >
                  <p className="text-sm font-medium text-rose-900">
                    自动执行被阻断
                  </p>
                  <p className="mt-2 text-sm leading-6 text-rose-800">
                    {pendingExecutionBlockerMessage}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
                  如果页面没有自动跳转到执行结果，可以手动提交当前计划。
                </p>
              )}

              <form
                action={`/api/analysis/sessions/${analysisSession.id}/execute`}
                className="mt-4"
                method="post"
              >
                {activeFollowUp?.id ? (
                  <input name="followUpId" type="hidden" value={activeFollowUp.id} />
                ) : null}
                <button
                  className="secondary-button"
                  disabled={Boolean(groundedPlanPreviewError)}
                  type="submit"
                >
                  手动执行当前计划
                </button>
              </form>

              <details
                className="mt-4 rounded-xl border border-[color:var(--line-200)] bg-white/70 p-4"
                data-testid="analysis-pending-plan-details"
              >
                <summary className="cursor-pointer text-sm font-medium text-[color:var(--ink-700)]">
                  查看执行计划与阻断原因
                </summary>
                <div className="mt-4">
                  <AnalysisPlanPanel
                    sessionId={analysisSession.id}
                    readModel={analysisPlanReadModel}
                    followUpId={activeFollowUp?.id}
                    blockingMessage={
                      groundedPlanPreviewError
                        ? formatGroundingErrorForUser(groundedPlanPreviewError)
                        : undefined
                    }
                  />
                </div>
              </details>
            </div>
          </div>

          {followUpInputBlock}
        </div>
      )}

    </section>
  );
}
