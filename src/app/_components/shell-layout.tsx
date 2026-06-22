import type { ReactNode } from 'react';

import { ShellMenu } from './shell-menu';
import type { ShellMenuItem } from './shell-menu-config';
import { ThemeToggle } from './workbench/theme-toggle';

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
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-[0.1em] text-[color:var(--brand-700)]">
              DIP3 · 智慧数据
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <ThemeToggle />
            <span>{userDisplayName}</span>
            <span className="text-border">|</span>
            <span className="text-xs">{userId}</span>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="text-xs text-muted-foreground hover:text-foreground"
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
