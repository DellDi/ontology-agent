import { notFound } from 'next/navigation';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { analysisIntentUseCases } from '@/infrastructure/analysis-intent';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { analysisPlanningUseCases } from '@/infrastructure/analysis-planning';
import { getIntentTypeLabel } from '@/domain/analysis-intent/models';
import { factorExpansionUseCases } from '@/infrastructure/factor-expansion';
import { requireWorkspaceSession } from '@/infrastructure/session/server-auth';
import { AnalysisContextPanel } from './_components/analysis-context-panel';
import { AnalysisPlanPanel } from './_components/analysis-plan-panel';
import { CandidateFactorPanel } from './_components/candidate-factor-panel';

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

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
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
  const candidateFactorReadModel = await factorExpansionUseCases.buildCandidateFactorReadModel({
    intentType: intent?.type ?? 'general-analysis',
    questionText: analysisSession.questionText,
    contextReadModel,
  });
  const analysisPlanReadModel = analysisPlanningUseCases.buildPlanReadModel({
    intentType: intent?.type ?? 'general-analysis',
    contextReadModel,
    candidateFactorReadModel,
  });
  const executionId = readSearchParam(resolvedSearchParams.executionId);
  const executionError = readSearchParam(
    resolvedSearchParams.executionError,
  );

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

        {(executionId || executionError) ? (
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
                  Execution ID：{executionId}
                </p>
              </>
            )}
          </article>
        ) : null}

        <AnalysisPlanPanel
          sessionId={analysisSession.id}
          readModel={analysisPlanReadModel}
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
