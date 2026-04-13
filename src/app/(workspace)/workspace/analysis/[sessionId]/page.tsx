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
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
  });
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
});
const ontologyRuntimeServices = createOntologyRuntimeServices();

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

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px]">
      <div className="space-y-6">
        <article className="hero-panel p-7 md:p-9">
          <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
            Analysis Session
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-[color:var(--ink-900)]">
            主分析区
          </h2>
          <p className="mt-4 text-base leading-7 text-[color:var(--ink-600)]">
            当前会话已经创建成功，后续意图识别、计划生成和执行步骤会围绕这条原始问题继续展开。
          </p>
        </article>

        <article className="glass-panel p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                会话起点
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
                {analysisSession.questionText}
              </h3>
            </div>
            <span className="rounded-full bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
              待分析
            </span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-white/76 p-5">
              <p className="text-xs text-[color:var(--ink-600)]">会话 ID</p>
              <p className="mt-2 break-all text-base text-[color:var(--ink-900)]">
                {analysisSession.id}
              </p>
            </div>
            <div className="rounded-3xl bg-white/76 p-5">
              <p className="text-xs text-[color:var(--ink-600)]">创建时间</p>
              <p className="mt-2 text-base text-[color:var(--ink-900)]">
                {analysisSession.createdAt}
              </p>
            </div>
          </div>
        </article>

        {intent && (
          <article className="glass-panel p-6" data-testid="intent-result">
            <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
              意图识别结果
            </p>
            <div className="mt-4 space-y-4">
              <div className="rounded-3xl bg-white/76 p-5">
                <p className="text-xs text-[color:var(--ink-600)]">分析类型</p>
                <p className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]" data-testid="intent-type">
                  {getIntentTypeLabel(intent.type)}
                </p>
              </div>
              <div className="rounded-3xl bg-white/76 p-5">
                <p className="text-xs text-[color:var(--ink-600)]">核心目标</p>
                <p className="mt-2 text-base leading-7 text-[color:var(--ink-900)]" data-testid="intent-goal">
                  {intent.goal}
                </p>
              </div>
            </div>
          </article>
        )}

        <AnalysisContextPanel
          sessionId={analysisSession.id}
          initialReadModel={contextReadModel}
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

        <AnalysisPlanPanel
          sessionId={analysisSession.id}
          readModel={analysisPlanReadModel}
          followUpId={activeFollowUp?.id}
          blockingMessage={groundedPlanPreviewError?.message}
        />

        {resolvedExecutionId && executionStreamReadModel ? (
          <AnalysisExecutionLiveShell
            sessionId={analysisSession.id}
            executionId={resolvedExecutionId}
            initialReadModel={executionStreamReadModel}
            initialConclusionReadModel={liveConclusionReadModel}
          />
        ) : liveConclusionReadModel ? (
          <AnalysisConclusionPanel readModel={liveConclusionReadModel} />
        ) : null}

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

        <AnalysisHistoryPanel
          sessionId={analysisSession.id}
          activeFollowUpId={activeFollowUp?.id}
          readModel={historyReadModel}
        />
      </div>

      <aside className="space-y-6">
        <CandidateFactorPanel readModel={candidateFactorReadModel} />

        <article className="glass-panel p-6">
          <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
            证据辅助区
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-[color:var(--ink-900)]">
            证据和计划将在这里逐步展开
          </h3>
          <p className="mt-4 text-sm leading-7 text-[color:var(--ink-600)]">
            Story 1.4 先保留稳定的右侧容器关系，后续会继续接入计划时间线、证据堆栈和原因排序面板。
          </p>
        </article>

        <article className="glass-panel p-6">
          <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
            会话导航区
          </p>
          <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]">
            左侧固定导航继续承载用户身份与权限范围，这里保留会话级补充信息和后续快捷动作。
          </p>
        </article>
      </aside>
    </section>
  );
}
