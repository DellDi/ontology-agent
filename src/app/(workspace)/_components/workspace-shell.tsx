'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ChevronsUpDown,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelLeft,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import { cn } from '@/app/_lib/cn';
import { EnvironmentBadge } from '@/app/_components/environment-badge';
import type { RuntimeEnvironmentView } from '@/application/runtime-environment/presentation';
import type { ShellMenuItem } from '@/app/_components/shell-menu-config';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WorkspaceSettingsDialog } from './workspace-settings-dialog';

export type WorkspaceSidebarSession = {
  id: string;
  title: string;
  href: string;
  derivedStatus: 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';
};

export type WorkspaceShellProps = {
  /** 管理类入口（本体治理 / 数据接入等），收入用户菜单"管理"分组 */
  adminItems: ShellMenuItem[];
  /** 当前连接的运行环境；null 表示无法读取，界面显示告警 */
  environment: RuntimeEnvironmentView | null;
  /** 侧栏折叠初始态（服务端自 cookie 解析，避免 hydration 不一致） */
  initialCollapsed?: boolean;
  /** 侧栏展开初始宽度 px，由 layout 从 cookie 解析 */
  initialWidth?: number;
  sessions: WorkspaceSidebarSession[];
  /** true 时侧栏会话区显示加载失败提示（不吞错、不伪装为空） */
  sessionsLoadFailed?: boolean;
  userDisplayName: string;
  userId: string;
  children: ReactNode;
};

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_COLLAPSED_W = 56;
/** cookie 值：'c' 收起 | 'e.<px>' 展开宽 */
function persistSidebar(value: string) {
  document.cookie = `dip3-ws-sidebar=${value};path=/;max-age=31536000;samesite=lax`;
}

function statusDotClass(status: WorkspaceSidebarSession['derivedStatus']): string {
  switch (status) {
    case 'running':
    case 'pending':
      return 'bg-primary';
    case 'failed':
      return 'bg-destructive';
    default:
      return 'bg-muted-foreground/40';
  }
}

/** 超长文本容器：overflow 隐藏 + hover 时内层横向滚动显全（globals.css sb-marquee） */
function MarqueeText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('block min-w-0 overflow-hidden', className)}>
      <span className="sb-marquee inline-block whitespace-nowrap">{children}</span>
    </span>
  );
}

function SessionList({
  sessions,
  loadFailed,
  pathname,
  textWidth,
}: {
  sessions: WorkspaceSidebarSession[];
  loadFailed: boolean;
  pathname: string;
  /** 文本可用宽度（侧栏宽 - 固定装饰），供 marquee 计算滚动距离 */
  textWidth: number;
}) {
  if (loadFailed) {
    return (
      <p className="px-2 py-1.5 text-xs text-destructive" role="alert">
        会话历史加载失败，请刷新重试
      </p>
    );
  }
  if (!sessions.length) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        暂无分析会话
      </p>
    );
  }
  return (
    <nav
      aria-label="分析会话历史"
      className="flex flex-col gap-0.5"
      style={{ ['--sb-text-w' as string]: `${textWidth}px` }}
    >
      {sessions.map((session) => {
        const active = pathname === session.href;
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={cn(
              'sb-marquee-parent flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors',
              'hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-secondary font-medium text-foreground'
                : 'text-foreground/85',
            )}
            href={session.href}
            key={session.id}
            title={session.title}
          >
            <span
              aria-hidden
              className={cn('size-1.5 shrink-0 rounded-full', statusDotClass(session.derivedStatus))}
            />
            <MarqueeText>{session.title}</MarqueeText>
          </Link>
        );
      })}
    </nav>
  );
}

/** 收起态图标栏（双击空白展开） */
function CollapsedRail({
  sessions,
  pathname,
  userDisplayName,
  userId,
  adminItems,
  onExpand,
  onOpenSettings,
}: {
  sessions: WorkspaceSidebarSession[];
  pathname: string;
  userDisplayName: string;
  userId: string;
  adminItems: ShellMenuItem[];
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  const iconBtn =
    'flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="flex h-full flex-col items-center py-3" onDoubleClick={onExpand}>
      <span
        className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary"
        title="DIP3 · 智慧数据"
      >
        D
      </span>
      <button
        aria-label="展开侧栏"
        className={cn(iconBtn, 'mt-2')}
        onClick={onExpand}
        title="展开侧栏（双击空白处也可）"
        type="button"
      >
        <PanelLeft aria-hidden className="size-4" />
      </button>
      <Link
        aria-label="新分析"
        className={cn(iconBtn, 'mt-1')}
        href="/workspace"
        title="新分析"
      >
        <MessageSquarePlus aria-hidden className="size-4" />
      </Link>
      <div aria-hidden className="my-2 h-px w-6 bg-border" />
      <ScrollArea className="min-h-0 w-full flex-1">
        <nav aria-label="分析会话历史" className="flex flex-col items-center gap-0.5">
          {sessions.map((session) => {
            const active = pathname === session.href;
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                aria-label={session.title}
                className={cn(
                  iconBtn,
                  'relative',
                  active && 'bg-secondary text-foreground',
                )}
                href={session.href}
                key={session.id}
                title={session.title}
              >
                <MessageSquare aria-hidden className="size-4" />
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-1.5 right-1.5 size-1.5 rounded-full',
                    statusDotClass(session.derivedStatus),
                  )}
                />
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
      <div className="pt-2">
        <UserMenu
          adminItems={adminItems}
          collapsed
          onOpenSettings={onOpenSettings}
          userDisplayName={userDisplayName}
          userId={userId}
        />
      </div>
    </div>
  );
}

function UserMenu({
  adminItems,
  collapsed = false,
  onOpenSettings,
  userDisplayName,
  userId,
}: {
  adminItems: ShellMenuItem[];
  collapsed?: boolean;
  onOpenSettings: () => void;
  userDisplayName: string;
  userId: string;
}) {
  const avatar = (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {userDisplayName.slice(0, 1).toUpperCase()}
    </span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${userDisplayName} 的账户菜单`}
        className={cn(
          collapsed
            ? 'flex size-9 items-center justify-center rounded-lg hover:bg-secondary'
            : 'sb-marquee-parent flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-secondary',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {collapsed ? (
          avatar
        ) : (
          <>
            {avatar}
            <span className="min-w-0 flex-1">
              <MarqueeText className="text-sm font-medium text-foreground">
                {userDisplayName}
              </MarqueeText>
              <MarqueeText className="text-xs text-muted-foreground">
                {userId}
              </MarqueeText>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" side={collapsed ? 'right' : 'top'}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {userId}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/workspace/me">
            <UserRound aria-hidden className="size-4" />
            个人中心
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings aria-hidden className="size-4" />
          设置
        </DropdownMenuItem>
        {adminItems.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              管理
            </DropdownMenuLabel>
            {adminItems.map((item) => (
              <DropdownMenuItem asChild key={item.href}>
                <Link href={item.href}>
                  <ShieldCheck aria-hidden className="size-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            const form = document.createElement('form');
            form.method = 'post';
            form.action = '/api/auth/logout';
            document.body.appendChild(form);
            form.submit();
          }}
        >
          <LogOut aria-hidden className="size-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceShell({
  adminItems,
  environment,
  initialCollapsed = false,
  initialWidth,
  sessions,
  sessionsLoadFailed = false,
  userDisplayName,
  userId,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [width, setWidth] = useState(initialWidth ?? 256);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);

  const collapse = useCallback(() => {
    setCollapsed(true);
    persistSidebar('c');
  }, []);
  const expand = useCallback(() => {
    setCollapsed(false);
    persistSidebar(`e.${width}`);
  }, [width]);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const aside = asideRef.current;
      if (!aside) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = aside.getBoundingClientRect().width;
      setResizing(true);
      document.body.style.userSelect = 'none';
      const onMove = (ev: PointerEvent) => {
        setWidth(
          Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(startWidth + ev.clientX - startX))),
        );
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        document.body.style.userSelect = '';
        setResizing(false);
        const finalWidth = Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, Math.round(startWidth + ev.clientX - startX)),
        );
        setWidth(finalWidth);
        persistSidebar(`e.${finalWidth}`);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    },
    [],
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* 左侧栏：品牌 / 新分析 / 会话历史 / 用户入口。可收起为图标栏、可拖拽调宽 */}
      <aside
        className={cn(
          'relative hidden shrink-0 flex-col border-r border-border bg-secondary/40 md:flex',
          !resizing && 'transition-[width] duration-200 ease-out',
        )}
        ref={asideRef}
        style={{ width: collapsed ? SIDEBAR_COLLAPSED_W : width }}
      >
        {collapsed ? (
          <CollapsedRail
            adminItems={adminItems}
            onExpand={expand}
            onOpenSettings={() => setSettingsOpen(true)}
            pathname={pathname}
            sessions={sessions}
            userDisplayName={userDisplayName}
            userId={userId}
          />
        ) : (
          <>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm font-semibold tracking-[0.1em] text-primary">
                  DIP3 · 智慧数据
                </span>
                <EnvironmentBadge environment={environment} />
              </span>
              <button
                aria-label="收起侧栏"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={collapse}
                title="收起侧栏"
                type="button"
              >
                <PanelLeftClose aria-hidden className="size-4" />
              </button>
            </div>

            <div className="px-3 pb-1 pt-2">
              <Link
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2',
                  'text-sm font-medium text-foreground shadow-sm transition-colors',
                  'hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                href="/workspace"
              >
                <MessageSquarePlus aria-hidden className="size-4 shrink-0" />
                新分析
              </Link>
            </div>

            <div className="min-h-0 flex-1 py-2">
              <p className="px-5 pb-1.5 pt-1 text-xs text-muted-foreground">
                最近分析
              </p>
              <ScrollArea className="h-full px-3">
                <SessionList
                  loadFailed={sessionsLoadFailed}
                  pathname={pathname}
                  sessions={sessions}
                  textWidth={width - 64}
                />
              </ScrollArea>
            </div>

            <div className="border-t border-border p-3">
              <UserMenu
                adminItems={adminItems}
                onOpenSettings={() => setSettingsOpen(true)}
                userDisplayName={userDisplayName}
                userId={userId}
              />
            </div>
          </>
        )}

        {/* 右缘拖拽把手：展开态可手动调宽 */}
        {!collapsed ? (
          <div
            aria-hidden
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
            onPointerDown={startResize}
          />
        ) : null}
      </aside>

      {/* 中栏：内容区。fill-viewport 页（会话页）锁死为视口固定 + 内部滚动，
          其余页面在 main 内滚动 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动端顶栏（侧栏在 md 以下隐藏） */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              className="shrink-0 text-sm font-semibold tracking-[0.1em] text-primary"
              href="/workspace"
            >
              DIP3 · 智慧数据
            </Link>
            <EnvironmentBadge environment={environment} />
          </span>
          <button
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            设置
          </button>
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 has-[.fill-viewport]:flex has-[.fill-viewport]:flex-col has-[.fill-viewport]:overflow-hidden has-[.fill-viewport]:p-0 sm:px-6">
          {children}
        </main>
      </div>

      <WorkspaceSettingsDialog
        environment={environment}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
        userDisplayName={userDisplayName}
        userId={userId}
      />
    </div>
  );
}
