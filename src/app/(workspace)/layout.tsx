import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import {
  getCurrentViewer,
  getWorkspaceHome,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';

import { ingestionAccessSchema } from '@/infrastructure/java-backend/ingestion-schema';
import { readJavaBackend } from '@/infrastructure/java-backend/read-client';
import { getRuntimeEnvironment } from '@/infrastructure/java-backend/runtime-environment-client';
import { environmentTitle } from '@/application/runtime-environment/presentation';
import { canViewOntologyGovernance } from '@/domain/ontology/governance';
import {
  latestExecutionSnapshot,
  sessionToHistoryItem,
} from '@/application/workspace/home';
import {
  WorkspaceShell,
  type WorkspaceSidebarSession,
} from './_components/workspace-shell';
import { WORKSPACE_MENU } from '../_components/shell-menu-config';

type WorkspaceLayoutProps = {
  children: ReactNode;
};

/** 标签页标题带环境前缀，并排打开本地与公司环境时一眼可分。 */
export async function generateMetadata(): Promise<Metadata> {
  const title = environmentTitle(await getRuntimeEnvironment());
  return title ? { title } : {};
}

export default async function WorkspaceLayout({
  children,
}: WorkspaceLayoutProps) {
  let viewer;
  let access;
  try {
    [viewer, access] = await Promise.all([
      getCurrentViewer(),
      readJavaBackend('/api/admin/ingestion/access', ingestionAccessSchema),
    ]);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      return <>{children}</>;
    }
    throw error;
  }

  if (!viewer.workspaceAccess) {
    return (
      <main className="min-h-screen px-6 py-10 lg:px-10">
        <section className="mx-auto max-w-3xl">
          <article className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)] md:p-7">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--warning-500)]">
              访问受限
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-foreground">
              当前账号已登录，但还没有可用的分析范围
            </h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              当前账号暂无可用分析权限，请联系管理员开通项目范围。
            </p>
            <div className="mt-6">
              <form action="/api/auth/logout" method="post">
                <button
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                >
                  退出当前会话
                </button>
              </form>
            </div>
          </article>
        </section>
      </main>
    );
  }

  // 管理类入口：本体治理（按角色）与数据接入（按权限）收进用户菜单"管理"分组
  const adminItems = [
    ...WORKSPACE_MENU.filter(
      (item) =>
        item.href.startsWith('/admin') &&
        canViewOntologyGovernance(viewer.scope.roleCodes),
    ),
    ...(access.canView
      ? [
          {
            href: '/admin/ingestion',
            label: '数据接入',
            activePrefix: '/admin/ingestion',
          },
        ]
      : []),
  ];

  // 侧栏会话历史：独立取数，失败时侧栏显示失败提示而不是伪装为空
  let sidebarSessions: WorkspaceSidebarSession[] = [];
  let sessionsLoadFailed = false;
  try {
    const home = await getWorkspaceHome();
    sidebarSessions = home.sessions.map((session) => {
      const item = sessionToHistoryItem(
        session,
        latestExecutionSnapshot(session.latestExecution),
      );
      return {
        id: item.id,
        title: item.title,
        href: item.href,
        derivedStatus: item.derivedStatus,
      };
    });
  } catch {
    sessionsLoadFailed = true;
  }

  const environment = await getRuntimeEnvironment();

  // 侧栏折叠/宽度偏好：cookie 'c' 收起 | 'e.<px>' 展开宽（与 workspace-shell 写入逻辑一致）
  const sidebarPref = (await cookies()).get('dip3-ws-sidebar')?.value ?? '';
  const prefWidth = Number(sidebarPref.slice(2));
  const sidebarCollapsed = sidebarPref.startsWith('c');
  const sidebarWidth =
    sidebarPref.startsWith('e.') && Number.isFinite(prefWidth)
      ? Math.min(420, Math.max(200, Math.round(prefWidth)))
      : undefined;

  return (
    <WorkspaceShell
      adminItems={adminItems}
      environment={environment}
      initialCollapsed={sidebarCollapsed}
      initialWidth={sidebarWidth}
      sessions={sidebarSessions}
      sessionsLoadFailed={sessionsLoadFailed}
      userDisplayName={viewer.displayName}
      userId={viewer.userId}
    >
      {children}
    </WorkspaceShell>
  );
}
