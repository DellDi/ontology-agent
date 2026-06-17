import { redirect } from 'next/navigation';

import {
  getDevAuthPageState,
  getRequestSession,
  isDirectoryAuthAvailable,
} from '@/composition-root';
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
    <main className="min-h-screen bg-[#f5f7fb] text-[color:var(--ink-900)]">
      <header className="border-b border-[#d8e0ec] bg-white">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 md:px-8">
          <div>
            <p className="text-sm font-semibold tracking-[0.08em] text-[color:var(--brand-900)]">
              DIP3 · 智慧数据
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--ink-600)]">
              物业经营分析工作台
            </p>
          </div>
          <span className="hidden rounded-[8px] border border-[#d8e0ec] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[color:var(--ink-600)] md:inline-flex">
            ERP 目录账号登录
          </span>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 md:px-8 md:py-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <section className="order-1 rounded-[8px] border border-[#d8e0ec] bg-white p-5 shadow-[0_14px_34px_rgb(15_23_42/0.06)] md:p-6 lg:order-2">
          <div className="border-b border-[#e4e9f1] pb-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              账号登录
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-[color:var(--ink-900)]">
              登录 DIP3 工作台
            </h1>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
              使用 ERP 同步账号进入系统，权限范围由组织目录自动继承。
            </p>
          </div>

          <div className="mt-5 space-y-3">
            {errorMessage ? (
              <div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm leading-6 text-[#991b1b]">
                {errorMessage}
              </div>
            ) : null}
            {loggedOut === '1' ? (
              <div className="rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm leading-6 text-[#166534]">
                已安全退出当前会话。
              </div>
            ) : null}
          </div>

          {directoryAvailable ? (
            <form
              action="/api/auth/directory-login"
              method="post"
              className="mt-5 space-y-4"
            >
              <input type="hidden" name="next" value={nextPath} />

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[color:var(--ink-900)]">
                  账号
                </span>
                <input
                  className="h-11 w-full rounded-[8px] border border-[#cbd5e1] bg-white px-3 text-sm text-[color:var(--ink-900)] outline-none transition focus:border-[color:var(--brand-700)] focus:ring-4 focus:ring-blue-100"
                  type="text"
                  name="account"
                  placeholder="ERP 登录账号"
                  defaultValue={prefillAccount}
                  autoComplete="username"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[color:var(--ink-900)]">
                  密码
                </span>
                <input
                  className="h-11 w-full rounded-[8px] border border-[#cbd5e1] bg-white px-3 text-sm text-[color:var(--ink-900)] outline-none transition focus:border-[color:var(--brand-700)] focus:ring-4 focus:ring-blue-100"
                  type="password"
                  name="password"
                  placeholder="ERP 登录密码"
                  autoComplete="current-password"
                  required
                />
              </label>

              <button
                className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-[8px] bg-[color:var(--brand-900)] px-4 text-sm font-semibold text-white transition hover:bg-[color:var(--brand-700)] focus:ring-4 focus:ring-blue-100 focus:outline-none"
                type="submit"
              >
                进入 DIP3 工作台
              </button>
            </form>
          ) : null}

          {!directoryAvailable ? (
            <div className="mt-5 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm leading-6 text-[#92400e]">
              {devAuthState.disabledMessage}
            </div>
          ) : null}
        </section>

        <article className="order-2 space-y-6 lg:order-1">
          <div className="rounded-[8px] border border-[#d8e0ec] bg-white p-6 shadow-[0_14px_34px_rgb(15_23_42/0.04)] md:p-8">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              经营分析
            </p>
            <h2 className="mt-4 max-w-2xl text-3xl leading-tight font-semibold text-[color:var(--ink-900)] md:text-4xl">
              把经营问题沉淀为可复盘的分析结论
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[color:var(--ink-600)]">
              DIP3 面向物业经营分析团队，把问题输入、证据链分析、归因结论和历史会话组织在同一个权限边界内。
            </p>
          </div>

          <div className="grid gap-3">
            {businessCapabilities.map((capability) => (
              <section
                key={capability.title}
                className="rounded-[8px] border border-[#d8e0ec] bg-white p-5 shadow-[0_10px_24px_rgb(15_23_42/0.035)]"
              >
                <h3 className="text-base font-semibold text-[color:var(--ink-900)]">
                  {capability.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                  {capability.description}
                </p>
              </section>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
