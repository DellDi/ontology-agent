import { redirect } from 'next/navigation';

import {
  getDevAuthPageState,
  getRequestSession,
  isDirectoryAuthAvailable,
} from '@/composition-root';
import { hasWorkspaceAccess, sanitizeNextPath } from '@/domain/auth/models';
import { Badge } from '@/app/_components/workbench/badge';
import { StatusBanner } from '@/app/_components/workbench/status-banner';
import { Surface, SurfaceBody, SurfaceHeader } from '@/app/_components/workbench/surface';
import { DirectoryLoginForm } from './_components/directory-login-form';

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(
  value: string | string[] | undefined,
  fallback = '',
) {
  if (typeof value === 'string') {
    return value;
  }

  return fallback;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const nextPath = sanitizeNextPath(readSearchParam(params.next));
  const errorMessage = readSearchParam(params.error);
  const loggedOut = readSearchParam(params.loggedOut);
  const prefillAccount = readSearchParam(params.account);
  const session = await getRequestSession();
  const devAuthState = getDevAuthPageState();
  const directoryAvailable = isDirectoryAuthAvailable();

  if (session && hasWorkspaceAccess(session)) {
    redirect(nextPath);
  }

  const businessCapabilities = [
    {
      title: '业务问题入口',
      description:
        '从收费、回款、项目运营等真实问题发起会话，保留原始问题与后续分析上下文。',
    },
    {
      title: '证据化分析流程',
      description:
        '围绕候选因素、执行过程和结论证据组织结果，让分析过程可复盘、可追踪。',
    },
    {
      title: '组织与项目权限边界',
      description:
        '登录后自动继承目录权限，只展示当前账号可访问的组织、项目与历史会话。',
    },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 md:px-8">
          <div>
            <p className="text-sm font-semibold tracking-[0.08em] text-[color:var(--brand-900)]">
              DIP3 · 智慧数据
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              物业经营分析工作台
            </p>
          </div>
          <Badge tone="neutral" className="hidden md:inline-flex">
            ERP 目录账号登录
          </Badge>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 md:px-8 md:py-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <Surface className="order-1 lg:order-2">
          <SurfaceHeader
            eyebrow="账号登录"
            title="登录 DIP3 工作台"
            description="使用 ERP 同步账号进入系统，权限范围由组织目录自动继承。"
            className="border-b border-border"
          />

          <SurfaceBody className="pt-5">
          <div className="space-y-3">
            {errorMessage ? (
              <StatusBanner tone="error">
                {errorMessage}
              </StatusBanner>
            ) : null}
            {loggedOut === '1' ? (
              <StatusBanner tone="success">
                已安全退出当前会话。
              </StatusBanner>
            ) : null}
          </div>

          {directoryAvailable ? (
            <DirectoryLoginForm
              nextPath={nextPath}
              prefillAccount={prefillAccount}
            />
          ) : null}

          {!directoryAvailable ? (
            <StatusBanner tone="warning" className="mt-5">
              {devAuthState.disabledMessage}
            </StatusBanner>
          ) : null}
          </SurfaceBody>
        </Surface>

        <article className="order-2 space-y-6 lg:order-1">
          <Surface>
            <SurfaceHeader
              eyebrow="经营分析"
              title="把经营问题沉淀为可复盘的分析结论"
              description="DIP3 面向物业经营分析团队，把问题输入、证据链分析、归因结论和历史会话组织在同一个权限边界内。"
              className="[&>div]:max-w-2xl [&_h2]:text-3xl [&_h2]:md:text-4xl"
            />
          </Surface>

          <div className="grid gap-3">
            {businessCapabilities.map((capability) => (
              <Surface
                key={capability.title}
                variant="subtle"
                className="p-5"
              >
                <h3 className="text-base font-semibold text-foreground">
                  {capability.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {capability.description}
                </p>
              </Surface>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
