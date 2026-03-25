import { redirect } from 'next/navigation';

import {
  getDevAuthPageState,
  getRequestSession,
} from '@/infrastructure/session/server-auth';
import { hasWorkspaceAccess, sanitizeNextPath } from '@/domain/auth/models';

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
  const session = await getRequestSession();
  const devAuthState = getDevAuthPageState();

  if (session && hasWorkspaceAccess(session)) {
    redirect(nextPath);
  }

  return (
    <main className="min-h-screen px-6 py-10 lg:px-10">
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_420px]">
        <article className="hero-panel flex min-h-[520px] flex-col justify-between p-8 md:p-10">
          <div className="space-y-5">
            <span className="inline-flex items-center rounded-full border border-[color:var(--line-200)] bg-white/72 px-4 py-1 text-xs font-medium tracking-[0.24em] text-[color:var(--brand-700)] uppercase shadow-[var(--shadow-soft)]">
              DIP3 - Trusted Entry
            </span>
            <div className="space-y-4">
              <h1 className="font-display text-4xl leading-tight font-semibold text-[color:var(--ink-900)]">
                先确认身份，再进入受保护的分析工作台
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[color:var(--ink-600)]">
                这里不是新的账号系统，而是承接 ERP 身份的服务端会话入口。登录后，
                平台只在服务端持有会话，并把组织、项目与区域权限带入后续分析工作台。
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass-panel p-5">
              <p className="text-xs text-[color:var(--ink-600)]">Authority</p>
              <p className="mt-2 font-display text-2xl text-[color:var(--ink-900)]">
                ERP
              </p>
            </div>
            <div className="glass-panel p-5">
              <p className="text-xs text-[color:var(--ink-600)]">Session</p>
              <p className="mt-2 font-display text-2xl text-[color:var(--ink-900)]">
                HTTP-only
              </p>
            </div>
            <div className="glass-panel p-5">
              <p className="text-xs text-[color:var(--ink-600)]">Scope</p>
              <p className="mt-2 font-display text-2xl text-[color:var(--ink-900)]">
                Org / Project / Area
              </p>
            </div>
          </div>
        </article>

        <section className="glass-panel p-7 md:p-8">
          <div className="space-y-3">
            <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
              ERP Session Bridge
            </p>
            <h2 className="text-2xl font-semibold text-[color:var(--ink-900)]">
              {devAuthState.devErpAuthEnabled
                ? '开发联调登录入口'
                : 'ERP 登录接入状态'}
            </h2>
            <p className="text-sm leading-6 text-[color:var(--ink-600)]">
              {devAuthState.devErpAuthEnabled
                ? '在真实 ERP 协议落地前，当前入口使用可替换的服务端适配器模拟身份交换，保持页面层不依赖具体 ERP 协议细节。'
                : '当前环境下已关闭开发期身份伪造入口，避免在非联调场景暴露可绕过真实认证的入口。'}
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {errorMessage ? (
              <div className="status-banner" data-tone="error">
                {errorMessage}
              </div>
            ) : null}
            {loggedOut === '1' ? (
              <div className="status-banner" data-tone="success">
                已安全退出当前会话。
              </div>
            ) : null}
            <div className="status-banner" data-tone="info">
              登录成功后会进入权限范围内的 `/workspace`，未登录访问会自动跳回这里。
            </div>
            {!devAuthState.devErpAuthEnabled ? (
              <div className="status-banner" data-tone="warning">
                {devAuthState.disabledMessage}
              </div>
            ) : null}
          </div>

          {devAuthState.devErpAuthEnabled ? (
            <form
              action="/api/auth/login"
              method="post"
              className="mt-6 space-y-4"
            >
              <input type="hidden" name="next" value={nextPath} />

              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className="field-label">ERP 账号</span>
                  <input
                    className="field-input"
                    type="text"
                    name="employeeId"
                    placeholder="例如 u-1001"
                    defaultValue="u-1001"
                    required
                  />
                </label>

                <label>
                  <span className="field-label">显示名称</span>
                  <input
                    className="field-input"
                    type="text"
                    name="displayName"
                    placeholder="例如 王分析"
                    defaultValue="王分析"
                  />
                </label>
              </div>

              <label>
                <span className="field-label">组织编号</span>
                <input
                  className="field-input"
                  type="text"
                  name="organizationId"
                  placeholder="例如 org-hz-001"
                  defaultValue="org-hz-001"
                  required
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className="field-label">项目范围</span>
                  <input
                    className="field-input"
                    type="text"
                    name="projectIds"
                    placeholder="project-a,project-b"
                    defaultValue="project-a,project-b"
                  />
                </label>

                <label>
                  <span className="field-label">区域范围</span>
                  <input
                    className="field-input"
                    type="text"
                    name="areaIds"
                    placeholder="area-east,area-west"
                    defaultValue="area-east"
                  />
                </label>
              </div>

              <label>
                <span className="field-label">角色编码</span>
                <input
                  className="field-input"
                  type="text"
                  name="roleCodes"
                  placeholder="PROPERTY_ANALYST"
                  defaultValue="PROPERTY_ANALYST"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button className="primary-button" type="submit">
                  进入分析工作台
                </button>
                <a
                  className="secondary-button"
                  href={`/api/auth/callback?ticket=u-1001|王分析|org-hz-001|project-a,project-b|area-east|PROPERTY_ANALYST&next=${encodeURIComponent(nextPath)}`}
                >
                  模拟 ERP 回调
                </a>
              </div>
            </form>
          ) : null}
        </section>
      </section>
    </main>
  );
}
