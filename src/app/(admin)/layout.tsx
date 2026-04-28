import Link from 'next/link';
import type { ReactNode } from 'react';

import { getOntologyAdminSessionState } from '@/infrastructure/session/admin-auth';

type AdminLayoutProps = {
  children: ReactNode;
};

const NAV_ITEMS = [
  { href: '/admin/ontology', label: '概览', segment: 'overview' },
  { href: '/admin/ontology/definitions', label: '本体定义', segment: 'definitions' },
  { href: '/admin/ontology/change-requests', label: '变更申请', segment: 'change-requests' },
  { href: '/admin/ontology/publishes', label: '发布记录', segment: 'publishes' },
];

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

  const { session, capabilities } = state;

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="glass-panel space-y-6 p-6">
          <div>
            <p className="text-xs font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
              Ontology Governance Console
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              本体治理后台
            </h1>
            <p className="mt-1 text-sm text-[color:var(--ink-600)]">
              {session.displayName} · {session.userId}
            </p>
          </div>

          <nav className="space-y-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-2xl bg-white/70 px-4 py-3 text-sm font-medium text-[color:var(--ink-900)] transition hover:bg-white hover:shadow-[var(--shadow-soft)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="space-y-2 rounded-3xl bg-white/75 p-4 text-xs text-[color:var(--ink-600)]">
            <p className="font-semibold text-[color:var(--brand-700)] uppercase tracking-[0.18em]">
              当前角色能力
            </p>
            <ul className="space-y-1">
              <li>查看治理面：{capabilities.canView ? '✅' : '⛔'}</li>
              <li>提交变更：{capabilities.canAuthor ? '✅' : '⛔'}</li>
              <li>审批/驳回：{capabilities.canReview ? '✅' : '⛔'}</li>
              <li>发布版本：{capabilities.canPublish ? '✅' : '⛔'}</li>
            </ul>
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
