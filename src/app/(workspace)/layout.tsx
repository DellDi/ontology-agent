import type { ReactNode } from 'react';

import { getWorkspaceSessionState } from '@/infrastructure/session/server-auth';

type WorkspaceLayoutProps = {
  children: ReactNode;
};

export default async function WorkspaceLayout({
  children,
}: WorkspaceLayoutProps) {
  const workspaceSessionState = await getWorkspaceSessionState();

  if (!workspaceSessionState) {
    return <>{children}</>;
  }

  const { session, accessDeniedMessage } = workspaceSessionState;

  if (accessDeniedMessage) {
    return (
      <main className="min-h-screen px-6 py-10 lg:px-10">
        <section className="mx-auto max-w-3xl">
          <article className="glass-panel p-8 md:p-10">
            <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--warning-500)] uppercase">
              Access Restricted
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-[color:var(--ink-900)]">
              当前账号已登录，但还没有可用的分析范围
            </h1>
            <p className="mt-4 text-base leading-7 text-[color:var(--ink-600)]">
              {accessDeniedMessage}
            </p>
            <div className="mt-6">
              <form action="/api/auth/logout" method="post">
                <button className="secondary-button" type="submit">
                  退出当前会话
                </button>
              </form>
            </div>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="glass-panel space-y-6 p-6">
          <div>
            <p className="text-xs font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
              Secure Session
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              {session.displayName}
            </h1>
            <p className="mt-1 text-sm text-[color:var(--ink-600)]">
              用户标识：{session.userId}
            </p>
          </div>

          <div className="space-y-3 text-sm text-[color:var(--ink-600)]">
            <div className="rounded-3xl bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">
                组织
              </p>
              <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
                {session.scope.organizationId}
              </p>
            </div>
            <div className="rounded-3xl bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">
                项目范围
              </p>
              <p className="mt-2 text-base text-[color:var(--ink-900)]">
                {session.scope.projectIds.join(', ') || '未配置'}
              </p>
            </div>
          </div>

          <form action="/api/auth/logout" method="post">
            <button className="secondary-button w-full" type="submit">
              退出当前会话
            </button>
          </form>
        </aside>

        <section>{children}</section>
      </div>
    </main>
  );
}
