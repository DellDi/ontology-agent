import { notFound } from 'next/navigation';

import { createCompositionRoot, requireWorkspaceSession } from '@/composition-root';
import { buildAnalysisSessionPageModel } from '@/application/analysis-session/build-session-page-model';
import { AnalysisContextPanel } from './_components/analysis-context-panel';
import { AnalysisExecutionLiveShell } from './_components/analysis-execution-live-shell';
import { AnalysisFollowUpPanel } from './_components/analysis-follow-up-panel';
import { AnalysisFollowUpInput } from './_components/analysis-follow-up-input';
import { AnalysisHistoryPanel } from './_components/analysis-history-panel';
import { AnalysisPlanPanel } from './_components/analysis-plan-panel';
import { AnalysisPendingRefreshGate } from './_components/analysis-pending-refresh-gate';
import { AnalysisAutoExecuteGate } from './_components/analysis-auto-execute-gate';
import { CandidateFactorPanel } from './_components/candidate-factor-panel';

type AnalysisSessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AnalysisSessionPage({
  params,
  searchParams,
}: AnalysisSessionPageProps) {
  const root = createCompositionRoot();
  const { sessionId } = await params;
  const { session: currentUser, accessDeniedMessage } =
    await requireWorkspaceSession(`/workspace/analysis/${sessionId}`);

  if (accessDeniedMessage) {
    return null;
  }

  const pageModel = await buildAnalysisSessionPageModel({
    root,
    sessionId,
    owner: currentUser,
    searchParams: (await searchParams) ?? {},
  });

  if (!pageModel) {
    notFound();
  }

  const followUpInputBlock = pageModel.followUpSection.hasInput ? (
    <AnalysisFollowUpInput
      sessionId={pageModel.followUpSection.sessionId}
      activeFollowUpId={pageModel.followUpSection.activeFollowUpId}
      drawerContent={
        <AnalysisFollowUpPanel
          sessionId={pageModel.followUpSection.sessionId}
          activeFollowUpId={pageModel.followUpSection.activeFollowUpId}
          latestConclusionTitle={pageModel.followUpSection.latestConclusionTitle}
          latestConclusionSummary={pageModel.followUpSection.latestConclusionSummary}
          inheritedContext={pageModel.followUpSection.inheritedContext}
          followUps={pageModel.followUpSection.followUps}
          adjustmentDraft={pageModel.followUpSection.adjustmentDraft}
          conflictItems={pageModel.followUpSection.conflictItems}
          feedback={pageModel.followUpSection.feedback}
          replanFeedback={pageModel.followUpSection.replanFeedback}
        />
      }
    />
  ) : null;

  return (
    <section className="mx-auto w-full max-w-[920px] space-y-6 px-2">
      {/* 自动执行 gate */}
      <AnalysisAutoExecuteGate
        sessionId={pageModel.sessionId}
        followUpId={pageModel.activeFollowUpId}
        enabled={pageModel.shouldAutoExecute}
      />
      <AnalysisPendingRefreshGate enabled={pageModel.shouldRefreshPendingExecution} />

      {/* 执行提交反馈（轻量 banner） */}
      {pageModel.shouldShowExecutionFeedback ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          data-testid="analysis-execution-feedback"
          style={{
            backgroundColor: pageModel.executionError
              ? 'rgb(255 106 106 / 10%)'
              : 'rgb(49 185 130 / 10%)',
            color: pageModel.executionError
              ? 'rgb(159 57 57)'
              : 'rgb(18 96 69)',
          }}
        >
          {pageModel.executionError ? (
            <p>{pageModel.executionError}</p>
          ) : (
            <p>{pageModel.executionFeedbackMessage}</p>
          )}
        </div>
      ) : null}

      {/* 主聊天窗口 */}
      {pageModel.resolvedExecutionId && pageModel.executionStreamReadModel ? (
        <AnalysisExecutionLiveShell
          sessionId={pageModel.sessionId}
          executionId={pageModel.resolvedExecutionId}
          ownerUserId={pageModel.ownerUserId}
          initialReadModel={pageModel.executionStreamReadModel}
          initialConclusionReadModel={pageModel.liveConclusionReadModel}
          initialProjection={pageModel.projectionHydration?.projection ?? null}
          resumeCursor={pageModel.projectionHydration?.resumeCursor ?? null}
          enableLiveStream={pageModel.enableLiveStream}
          ontologyVersionBinding={pageModel.ontologyVersionBindingForDisplay}
          planAssumptions={pageModel.analysisPlanReadModel.assumptions}
          questionText={pageModel.questionText}
          intentLabel={pageModel.intentLabel}
          ontologyVersionBadge={pageModel.ontologyVersionBadgeText ?? undefined}
          followUpLabel={pageModel.followUpLabel}
          candidateFactors={pageModel.mergedCandidateFactorReadModel.factors}
          thread={pageModel.thread}
          drawerContents={{
            plan: (
              <AnalysisPlanPanel
                sessionId={pageModel.sessionId}
                readModel={pageModel.analysisPlanReadModel}
                followUpId={pageModel.activeFollowUpId}
                blockingMessage={pageModel.groundedPlanPreviewErrorMessage}
              />
            ),
            context: (
              <AnalysisContextPanel
                sessionId={pageModel.sessionId}
                initialReadModel={pageModel.contextReadModel}
              />
            ),
            history: (
              <AnalysisHistoryPanel
                sessionId={pageModel.sessionId}
                activeFollowUpId={pageModel.activeFollowUpId}
                readModel={pageModel.historyReadModel}
              />
            ),
            candidates: (
              <CandidateFactorPanel readModel={pageModel.mergedCandidateFactorReadModel} />
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
                {pageModel.questionText}
              </p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="w-full max-w-[90%]">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-2.5 w-2.5 rounded-full ${
                    pageModel.pendingExecutionBlockerMessage
                      ? 'bg-rose-400'
                      : 'bg-[color:var(--ink-600)]/30'
                  }`}
                />
                <p className="text-sm font-medium text-[color:var(--ink-900)]">
                  {pageModel.pendingExecutionHeadline}
                </p>
              </div>

              {pageModel.pendingExecutionBlockerMessage ? (
                <div
                  className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
                  data-testid="analysis-execution-blocked"
                >
                  <p className="text-sm font-medium text-rose-900">
                    自动执行被阻断
                  </p>
                  <p className="mt-2 text-sm leading-6 text-rose-800">
                    {pageModel.pendingExecutionBlockerMessage}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
                  如果页面没有自动跳转到执行结果，可以手动提交当前计划。
                </p>
              )}

              <form
                action={`/api/analysis/sessions/${pageModel.sessionId}/execute`}
                className="mt-4"
                method="post"
              >
                {pageModel.activeFollowUpId ? (
                  <input name="followUpId" type="hidden" value={pageModel.activeFollowUpId} />
                ) : null}
                <button
                  className="secondary-button"
                  disabled={Boolean(pageModel.groundedPlanPreviewError)}
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
                    sessionId={pageModel.sessionId}
                    readModel={pageModel.analysisPlanReadModel}
                    followUpId={pageModel.activeFollowUpId}
                    blockingMessage={pageModel.groundedPlanPreviewErrorMessage}
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