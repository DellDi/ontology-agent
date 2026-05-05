import type { ReactNode } from 'react';

import { ShellMenu } from './shell-menu';
import type { ShellMenuItem } from './shell-menu-config';

type ShellLayoutProps = {
  menuItems: ShellMenuItem[];
  userDisplayName: string;
  userId: string;
  children: ReactNode;
};

export function ShellLayout({
  menuItems,
  userDisplayName,
  userId,
  children,
}: ShellLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-[color:var(--line-200)] bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-[0.15em] text-[color:var(--brand-700)]">
              DIP3 · 智慧数据
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-[color:var(--ink-600)]">
            <span>{userDisplayName}</span>
            <span className="text-[color:var(--line-300)]">|</span>
            <span className="text-xs">{userId}</span>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="text-xs text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]"
              >
                退出
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-6 py-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-10">
        <aside className="space-y-1">
          <ShellMenu items={menuItems} />
        </aside>
        <section>{children}</section>
      </div>
    </div>
  );
}
