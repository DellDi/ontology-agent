import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  getJavaOntologyAdminSessionState,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';

import { ShellLayout } from '../_components/shell-layout';
import { ADMIN_MENU } from '../_components/shell-menu-config';

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  let state;
  try {
    state = await getJavaOntologyAdminSessionState();
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      return <>{children}</>;
    }
    throw error;
  }

  if (!state) {
    return <>{children}</>;
  }

  if (state.accessDeniedMessage) {
    return (
      <main className="min-h-screen px-6 py-10 lg:px-10">
        <section className="mx-auto max-w-3xl">
          <article className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)] md:p-7">
            <p className="text-xs font-semibold tracking-[0.12em] text-amber-600 dark:text-amber-400">
              访问受限
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-foreground">
              本体治理后台访问受限
            </h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {state.accessDeniedMessage}
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/workspace" className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60">
                返回工作台
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60" type="submit">
                  退出当前会话
                </button>
              </form>
            </div>
          </article>
        </section>
      </main>
    );
  }

  const { viewer } = state;

  return (
    <ShellLayout
      menuItems={ADMIN_MENU}
      userDisplayName={viewer.displayName}
      userId={viewer.userId}
    >
      {children}
    </ShellLayout>
  );
}
