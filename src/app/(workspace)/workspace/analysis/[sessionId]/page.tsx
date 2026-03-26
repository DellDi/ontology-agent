import { notFound } from 'next/navigation';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { requireRequestSession } from '@/infrastructure/session/server-auth';

type AnalysisSessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});

export default async function AnalysisSessionPage({
  params,
}: AnalysisSessionPageProps) {
  const [{ sessionId }, currentUser] = await Promise.all([
    params,
    requireRequestSession('/workspace'),
  ]);

  const analysisSession = await analysisSessionUseCases.getOwnedSession({
    sessionId,
    ownerUserId: currentUser.userId,
  });

  if (!analysisSession) {
    notFound();
  }

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
      </div>

      <aside className="space-y-6">
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
