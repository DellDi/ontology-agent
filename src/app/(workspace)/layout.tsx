import type { ReactNode } from 'react';

import { getWorkspaceSessionState } from '@/composition-root';

import { ShellLayout } from '../_components/shell-layout';
import { WORKSPACE_MENU } from '../_components/shell-menu-config';

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
          <article className="glass-panel p-6 md:p-7">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--warning-500)]">
              访问受限
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-[color:var(--ink-900)]">
              当前账号已登录，但还没有可用的分析范围
            </h1>
            <p className="mt-4 text-sm leading-6 text-[color:var(--ink-600)]">
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
    <ShellLayout
      menuItems={WORKSPACE_MENU}
      userDisplayName={session.displayName}
      userId={session.userId}
    >
      {children}
    </ShellLayout>
  );
}
