import { redirect } from 'next/navigation';

import {
  getDevAuthPageState,
  getRequestSession,
  isDirectoryAuthAvailable,
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
  const prefillAccount = readSearchParam(params.account);
  const session = await getRequestSession();
  const devAuthState = getDevAuthPageState();
  const directoryAvailable = isDirectoryAuthAvailable();

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
                使用已同步 ERP 的账号登录。平台只在服务端持有会话，组织与项目权限由目录自动推导，无需手动填写。
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass-panel p-5">
              <p className="text-xs text-[color:var(--ink-600)]">Authority</p>
              <p className="mt-2 font-display text-2xl text-[color:var(--ink-900)]">
                ERP 目录
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
                Org / Project
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
              登录
            </h2>
            <p className="text-sm leading-6 text-[color:var(--ink-600)]">
              使用 ERP 同步账号与密码登录。权限范围由组织目录自动推导，无需手填。
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
          </div>

          {directoryAvailable ? (
            <form
              action="/api/auth/directory-login"
              method="post"
              className="mt-6 space-y-4"
            >
              <input type="hidden" name="next" value={nextPath} />

              <label>
                <span className="field-label">账号</span>
                <input
                  className="field-input"
                  type="text"
                  name="account"
                  placeholder="ERP 登录账号"
                  defaultValue={prefillAccount}
                  autoComplete="username"
                  required
                />
              </label>

              <label>
                <span className="field-label">密码</span>
                <input
                  className="field-input"
                  type="password"
                  name="password"
                  placeholder="ERP 登录密码"
                  autoComplete="current-password"
                  required
                />
              </label>

              <div className="pt-2">
                <button className="primary-button w-full" type="submit">
                  进入分析工作台
                </button>
              </div>
            </form>
          ) : null}

          {!directoryAvailable ? (
            <div className="mt-6">
              <div className="status-banner" data-tone="warning">
                {devAuthState.disabledMessage}
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
