import { notFound } from 'next/navigation';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import { analysisHistoryUseCases } from '@/application/analysis-history/use-cases';
import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import {
  buildGroundedPlanningArtifacts,
  buildGroundingBlockedPlanReadModel,
} from '@/application/ontology/grounded-planning';
import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';
import { resolveOntologyVersionBindingForDisplay } from '@/domain/ontology/version-binding';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { analysisIntentUseCases } from '@/infrastructure/analysis-intent';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { createOntologyRuntimeServices } from '@/infrastructure/ontology/runtime';
import { analysisPlanningUseCases } from '@/infrastructure/analysis-planning';
import { getIntentTypeLabel } from '@/domain/analysis-intent/models';
import { factorExpansionUseCases } from '@/infrastructure/factor-expansion';
import { requireWorkspaceSession } from '@/infrastructure/session/server-auth';
import { AnalysisContextPanel } from './_components/analysis-context-panel';
import { AnalysisConclusionPanel } from './_components/analysis-conclusion-panel';
import { AnalysisExecutionLiveShell } from './_components/analysis-execution-live-shell';
import { AnalysisFollowUpPanel } from './_components/analysis-follow-up-panel';
import { AnalysisHistoryPanel } from './_components/analysis-history-panel';
import { AnalysisPlanPanel } from './_components/analysis-plan-panel';
import { AnalysisAutoExecuteGate } from './_components/analysis-auto-execute-gate';
import { CandidateFactorPanel } from './_components/candidate-factor-panel';
import { withJobUseCases } from '@/infrastructure/job/runtime';
import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import {
  buildExecutionStreamReadModelFromSnapshot,
  getSessionScopedExecutionJob,
  getSessionScopedExecutionSnapshot,
} from './analysis-execution-display';

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
  const snapshotForDisplay =
    sessionScopedRequestedExecutionSnapshot ??
    (!requestedExecutionIdForDisplay ? latestExecutionSnapshot : null);
  const planSnapshotForDisplay =
    sessionScopedRequestedExecutionSnapshot?.planSnapshot ??
    requestedExecutionRuntime.requestedExecutionJob?.planSnapshot ??
    (activeFollowUp
      ? activeFollowUp.currentPlanSnapshot
      : snapshotForDisplay?.planSnapshot) ??
    null;
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
  const resolvedExecutionId =
    requestedExecutionIdForDisplay || snapshotForDisplay?.executionId || '';
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
  const ontologyVersionBindingForDisplay =
    resolveOntologyVersionBindingForDisplay({
      snapshotBinding: snapshotForDisplay?.ontologyVersionBinding ?? null,
      followUpBinding: activeFollowUp?.ontologyVersionBinding ?? null,
    });
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
  const historyReadModel = analysisHistoryUseCases.buildHistoryReadModel({
    session: analysisSession,
    sessionContext: contextReadModel.context,
    followUps,
    snapshots: sessionSnapshots,
    selectedRoundId: historyRoundId || null,
  });
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

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-6">
        <article className="glass-panel p-6">
          <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
            Analysis Session
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
            {analysisSession.questionText}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {intent ? (
              <span
                className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-sm font-medium text-[color:var(--brand-700)]"
                data-testid="intent-result"
              >
                {getIntentTypeLabel(intent.type)}
              </span>
            ) : null}
            {activeFollowUp ? (
              <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-[color:var(--ink-600)]">
                当前轮次：追问模式
              </span>
            ) : null}
          </div>
          {intent?.goal ? (
            <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]" data-testid="intent-goal">
              {intent.goal}
            </p>
          ) : null}
        </article>

        <AnalysisPlanPanel
          sessionId={analysisSession.id}
          readModel={analysisPlanReadModel}
          followUpId={activeFollowUp?.id}
          blockingMessage={groundedPlanPreviewError?.message}
        />

        <AnalysisAutoExecuteGate
          sessionId={analysisSession.id}
          followUpId={activeFollowUp?.id}
          enabled={shouldAutoExecute}
        />

        {(requestedExecutionIdForDisplay || executionError) ? (
          <article
            className="glass-panel p-6"
            data-testid="analysis-execution-feedback"
          >
            <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
              执行提交状态
            </p>
            {executionError ? (
              <div className="status-banner mt-4" data-tone="error">
                {executionError}
              </div>
            ) : (
              <>
                <div className="status-banner mt-4" data-tone="success">
                  已提交执行
                </div>
                <p className="mt-4 text-sm leading-7 text-[color:var(--ink-600)]">
                  执行任务已进入后台队列，后续会按当前计划逐步处理。
                </p>
                <p className="mt-3 text-sm text-[color:var(--ink-900)]">
                  Execution ID：{requestedExecutionIdForDisplay}
                </p>
              </>
            )}
          </article>
        ) : null}

        {resolvedExecutionId && executionStreamReadModel ? (
          <AnalysisExecutionLiveShell
            sessionId={analysisSession.id}
            executionId={resolvedExecutionId}
            ownerUserId={currentUser.userId}
            initialReadModel={executionStreamReadModel}
            initialConclusionReadModel={liveConclusionReadModel}
            ontologyVersionBinding={ontologyVersionBindingForDisplay}
            planAssumptions={analysisPlanReadModel.assumptions}
          />
        ) : liveConclusionReadModel ? (
          <AnalysisConclusionPanel
            readModel={liveConclusionReadModel}
            ontologyVersionBinding={ontologyVersionBindingForDisplay}
            planAssumptions={analysisPlanReadModel.assumptions}
          />
        ) : null}

        <details className="glass-panel p-6">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--ink-900)]">
            上下文修正（可选）
          </summary>
          <div className="mt-4">
            <AnalysisContextPanel
              sessionId={analysisSession.id}
              initialReadModel={contextReadModel}
            />
          </div>
        </details>

        {latestFollowUpConclusion ? (
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
        ) : null}

        <details className="glass-panel p-6">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--ink-900)]">
            历史回放（可选）
          </summary>
          <div className="mt-4">
            <AnalysisHistoryPanel
              sessionId={analysisSession.id}
              activeFollowUpId={activeFollowUp?.id}
              readModel={historyReadModel}
            />
          </div>
        </details>
      </div>

      <aside className="space-y-6">
        <details className="glass-panel p-6">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--ink-900)]">
            候选因素（可选）
          </summary>
          <div className="mt-4">
            <CandidateFactorPanel readModel={candidateFactorReadModel} />
          </div>
        </details>
      </aside>
    </section>
  );
}
