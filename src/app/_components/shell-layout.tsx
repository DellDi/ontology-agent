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
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-[0.1em] text-primary">
              DIP3 · 智慧数据
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground sm:gap-4">
            <ThemeToggle />
            <span className="hidden sm:inline">{userDisplayName}</span>
            <span className="hidden text-border sm:inline">|</span>
            <span className="hidden text-xs sm:inline">{userId}</span>
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
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-6 sm:gap-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-10 lg:py-8">
        <aside className="space-y-1">
          <ShellMenu items={menuItems} />
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
