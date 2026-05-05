import Link from 'next/link';
import type { ReactNode } from 'react';

import { getOntologyAdminSessionState } from '@/infrastructure/session/admin-auth';

import { ShellLayout } from '../_components/shell-layout';
import { ADMIN_MENU } from '../_components/shell-menu-config';

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const state = await getOntologyAdminSessionState();

  if (!state) {
    return <>{children}</>;
  }

  if (state.accessDeniedMessage) {
    return (
      <main className="min-h-screen px-6 py-10 lg:px-10">
        <section className="mx-auto max-w-3xl">
          <article className="glass-panel p-8 md:p-10">
            <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--warning-500)] uppercase">
              Access Restricted
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-[color:var(--ink-900)]">
              本体治理后台访问受限
            </h1>
            <p className="mt-4 text-base leading-7 text-[color:var(--ink-600)]">
              {state.accessDeniedMessage}
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/workspace" className="secondary-button">
                返回工作台
              </Link>
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

  const { session } = state;

  return (
    <ShellLayout
      menuItems={ADMIN_MENU}
      userDisplayName={session.displayName}
      userId={session.userId}
    >
      {children}
    </ShellLayout>
  );
}
