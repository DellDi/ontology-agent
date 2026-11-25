'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ChevronsUpDown,
  Database,
  Layers3,
  LogOut,
  History,
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
  updatedAt?: string;
  updatedAtLabel?: string;
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

const compactSidebarQuery = '(max-width: 1199px)';
function subscribeCompactSidebar(onChange: () => void) {
  const media = window.matchMedia(compactSidebarQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const getCompactSidebar = () => window.matchMedia(compactSidebarQuery).matches;
const getServerCompactSidebar = () => false;

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_COLLAPSED_W = 56;
/** cookie 值：'c' 收起 | 'e.<px>' 展开宽 */
function persistSidebar(value: string) {
  document.cookie = `dip3-ws-sidebar=${value};path=/;max-age=31536000;samesite=lax`;
}

function statusDotClass(status: WorkspaceSidebarSession['derivedStatus']): string | null {
  switch (status) {
    case 'running':
    case 'pending':
      return 'bg-primary animate-pulse motion-reduce:animate-none';
    case 'failed':
      return 'bg-destructive';
    default:
      return null;
  }
}

/** 按上海时区将历史会话归入「今天 / 昨天 / 近 7 天 / 更早」，降低左侧列表视觉噪音。 */
function groupSessionsByDate(
  sessions: WorkspaceSidebarSession[],
): Array<{ label: string; items: WorkspaceSidebarSession[] }> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayKey = (date: Date) => formatter.format(date);
  const now = new Date();
  const todayStr = dayKey(now);
  const todayMidnight = Date.parse(`${todayStr}T00:00:00+08:00`);

  const buckets = new Map<string, WorkspaceSidebarSession[]>();
  const push = (label: string, session: WorkspaceSidebarSession) => {
    const existing = buckets.get(label);
    if (existing) existing.push(session);
    else buckets.set(label, [session]);
  };

  for (const session of sessions) {
    const rawTime = session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN;
    if (!Number.isFinite(rawTime)) {
      push('更早', session);
      continue;
    }
    const itemMidnight = Date.parse(`${dayKey(new Date(rawTime))}T00:00:00+08:00`);
    const diffDays = Math.round((todayMidnight - itemMidnight) / 86_400_000);
    if (diffDays <= 0) push('今天', session);
    else if (diffDays === 1) push('昨天', session);
    else if (diffDays <= 7) push('近 7 天', session);
    else if (diffDays <= 30) push('近 30 天', session);
    else push('更早', session);
  }

  return Array.from(buckets.entries()).map(([label, items]) => ({ label, items }));
}

function SessionList({
  sessions,
  loadFailed,
  pathname,
}: {
  sessions: WorkspaceSidebarSession[];
  loadFailed: boolean;
  pathname: string;
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
  const groups = groupSessionsByDate(sessions);
  const showGroupHeaders = groups.length > 1 || (groups[0]?.label && groups[0].label !== '更早');

  return (
    <nav aria-label="分析会话历史" className="flex flex-col gap-3.5 pb-2">
      {groups.map((group) => (
        <div className="flex flex-col gap-0.5" key={group.label}>
          {showGroupHeaders ? (
            <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground/80">
              {group.label}
            </p>
          ) : null}
          {group.items.map((session) => {
            const active = pathname === session.href;
            const dotClass = statusDotClass(session.derivedStatus);
            const tooltip = session.updatedAtLabel
              ? `${session.title}\n${session.updatedAtLabel}`
              : session.title;
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] leading-snug transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border border-border/75 bg-card font-medium text-foreground shadow-[var(--shadow-panel)]'
                    : 'border border-transparent text-foreground/75 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]',
                )}
                href={session.href}
                key={session.id}
                title={tooltip}
              >
                {dotClass ? (
                  <span
                    aria-hidden
                    className={cn('size-1.5 shrink-0 rounded-full', dotClass)}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
              </Link>
            );
          })}
        </div>
      ))}
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
      <Link aria-label="大屏目录" title="大屏目录" href="/workspace/screens" className={iconBtn}><Layers3 aria-hidden className="size-4" /></Link>
      <Link aria-label="分析数据" title="分析数据" href="/workspace/data" className={iconBtn}><Database aria-hidden className="size-4" /></Link>
      <Link aria-label="全部分析记录" title="全部分析记录" href="/workspace/history" className={iconBtn}><History aria-hidden className="size-4" /></Link>
      <div aria-hidden className="my-2 h-px w-6 bg-border" />
      <ScrollArea className="min-h-0 w-full flex-1">
        <nav aria-label="分析会话历史" className="flex flex-col items-center gap-0.5">
          {sessions.filter((session, index) => index < 4 || pathname === session.href).map((session) => {
            const active = pathname === session.href;
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                aria-label={`${session.title} · ${session.updatedAtLabel ?? ''}`}
                className={cn(
                  iconBtn,
                  'relative',
                  active && 'bg-accent text-accent-foreground',
                )}
                href={session.href}
                key={session.id}
                title={`${session.title} · ${session.updatedAtLabel ?? ''}`}
              >
                <MessageSquare aria-hidden className="size-4" />
                {statusDotClass(session.derivedStatus) ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute bottom-1.5 right-1.5 size-1.5 rounded-full',
                      statusDotClass(session.derivedStatus),
                    )}
                  />
                ) : null}
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
            : 'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.05]',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {collapsed ? (
          avatar
        ) : (
          <>
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {userDisplayName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {userId}
              </span>
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
        <DropdownMenuItem asChild>
          <Link href="/workspace/history"><History aria-hidden className="size-4" />分析记录</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/workspace/screens"><Layers3 aria-hidden className="size-4" />大屏目录</Link></DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/workspace/data">分析数据</Link>
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
  const compact = useSyncExternalStore(subscribeCompactSidebar, getCompactSidebar, getServerCompactSidebar);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const rail = collapsed || (compact && !compactExpanded);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);

  const collapse = useCallback(() => {
    setCollapsed(true);
    setCompactExpanded(false);
    persistSidebar('c');
  }, []);
  const expand = useCallback(() => {
    setCollapsed(false);
    setCompactExpanded(true);
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
          'relative z-30 hidden shrink-0 flex-col border-r border-border bg-sky-100 md:flex',
          compact && !rail && 'absolute inset-y-0 left-0 shadow-lg',
          !resizing && 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        )}
        ref={asideRef}
        style={{ width: rail ? SIDEBAR_COLLAPSED_W : width }}
      >
        {rail ? (
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
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm font-semibold text-foreground">
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
                  'flex items-center gap-2 rounded-xl border border-[var(--brand-300)]/40 bg-[var(--brand-soft)] px-3 py-2.5',
                  'text-sm font-medium text-[var(--brand-900)] shadow-[var(--shadow-panel)] transition-colors',
                  'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                href="/workspace"
              >
                <MessageSquarePlus aria-hidden className="size-4 shrink-0 text-primary" />
                新分析
              </Link>
            </div>

            <div className="flex min-h-0 flex-1 flex-col py-2">
              <div className="flex items-center justify-between px-5 pb-1.5 pt-1 text-xs text-muted-foreground">
                <p>最近分析</p>
                <Link href="/workspace/history" className="rounded-sm px-1 py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">全部记录</Link>
              </div>
              <ScrollArea className="min-h-0 flex-1 px-3">
                <SessionList
                  loadFailed={sessionsLoadFailed}
                  pathname={pathname}
                  sessions={sessions}
                />
              </ScrollArea>
            </div>

            <div className="border-t border-border p-3">
              <Link href="/workspace/screens" className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Layers3 aria-hidden className="size-4" />大屏目录</Link>
              <Link href="/workspace/data" className="mb-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Database aria-hidden className="size-4" />分析数据</Link>
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
        {!rail ? (
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
        <header className="flex items-center justify-between px-4 py-3 md:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              className="shrink-0 text-sm font-semibold text-foreground"
              href="/workspace"
            >
              DIP3 · 智慧数据
            </Link>
            <EnvironmentBadge environment={environment} />
          </span>
          <UserMenu
            adminItems={adminItems}
            collapsed
            onOpenSettings={() => setSettingsOpen(true)}
            userDisplayName={userDisplayName}
            userId={userId}
          />
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
