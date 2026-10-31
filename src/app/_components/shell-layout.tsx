import type { ReactNode } from 'react';

import { ShellMenu } from './shell-menu';
import type { ShellMenuItem } from './shell-menu-config';
import { EnvironmentBadge } from './environment-badge';
import type { RuntimeEnvironmentView } from '@/application/runtime-environment/presentation';
import { ThemeToggle } from './theme-toggle';

type ShellLayoutProps = {
  menuItems: ShellMenuItem[];
  horizontalNavigation?: boolean;
  environment: RuntimeEnvironmentView | null;
  userDisplayName: string;
  userId: string;
  children: ReactNode;
};

export function ShellLayout({
  menuItems,
  environment,
  horizontalNavigation = false,
  userDisplayName,
  userId,
  children,
}: ShellLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-[0.1em] text-primary">
              DIP3 · 智慧数据
            </span>
            <EnvironmentBadge environment={environment} />
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground sm:gap-4">
            <ThemeToggle />
            <span className="hidden sm:inline">{userDisplayName}</span>
            <span className="sr-only">账号 {userId}</span>
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
      <div className={horizontalNavigation
        ? "mx-auto w-full max-w-5xl flex-1 px-4 pb-12 sm:px-6"
        : "mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-6 sm:gap-6 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:px-10 lg:py-8"}>
        <aside className={horizontalNavigation ? "mb-8 border-b border-border py-3" : "space-y-1"}>
          <ShellMenu items={menuItems} horizontal={horizontalNavigation} />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
