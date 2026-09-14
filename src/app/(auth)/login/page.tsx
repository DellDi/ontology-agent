import { redirect } from 'next/navigation';

import {
  getAuthConfig,
  getCurrentViewer,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';
import { hasWorkspaceAccess, sanitizeNextPath } from '@/domain/auth/models';
import { StatusBanner } from '@/app/_components/workbench/status-banner';
import { Surface, SurfaceBody } from '@/app/_components/workbench/surface';
import { AccountLoginForm } from './_components/account-login-form';

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(value: string | string[] | undefined, fallback = '') {
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
  const authConfig = await getAuthConfig();
  const accountLoginAvailable = authConfig.accountLoginAvailable;

  let viewer: Awaited<ReturnType<typeof getCurrentViewer>> | null = null;
  try {
    viewer = await getCurrentViewer();
  } catch (error) {
    if (!(error instanceof JavaBackendHttpError && error.status === 401)) {
      throw error;
    }
  }

  if (viewer && hasWorkspaceAccess(viewer)) {
    redirect(nextPath);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold tracking-[0.08em] text-[color:var(--brand-900)]">
            DIP3 · 智慧数据
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            登录工作台
          </h1>
        </div>

        <Surface>
          <SurfaceBody className="pt-6">
            <div className="space-y-3">
              {errorMessage ? (
                <StatusBanner tone="error">{errorMessage}</StatusBanner>
              ) : null}
              {loggedOut === '1' ? (
                <StatusBanner tone="success">已安全退出当前会话。</StatusBanner>
              ) : null}
              {!accountLoginAvailable ? (
                <StatusBanner tone="warning">
                  账号登录当前不可用，请联系管理员。
                </StatusBanner>
              ) : null}
            </div>

            {accountLoginAvailable ? (
              <AccountLoginForm
                nextPath={nextPath}
                prefillAccount={prefillAccount}
              />
            ) : null}
          </SurfaceBody>
        </Surface>
      </div>
    </main>
  );
}
