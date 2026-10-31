import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getRuntimeEnvironment } from '@/infrastructure/java-backend/runtime-environment-client';
import { environmentTitle } from '@/application/runtime-environment/presentation';
import {
  getJavaOntologyAdminSessionState,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';
import { readJavaBackend } from '@/infrastructure/java-backend/read-client';
import { ingestionAccessSchema } from '@/infrastructure/java-backend/ingestion-schema';
import { ShellLayout } from '../_components/shell-layout';
import { ADMIN_MENU } from '../_components/shell-menu-config';

export async function generateMetadata(): Promise<Metadata> {
  const title = environmentTitle(await getRuntimeEnvironment());
  return title ? { title } : {};
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  let state;
  let access;
  let environment;
  try {
    [state, access, environment] = await Promise.all([
      getJavaOntologyAdminSessionState(),
      readJavaBackend('/api/admin/ingestion/access', ingestionAccessSchema),
      getRuntimeEnvironment(),
    ]);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401)
      return <>{children}</>;
    throw error;
  }
  return (
    <ShellLayout
      environment={environment}
      menuItems={ADMIN_MENU.filter(
        (item) =>
          item.href === '/workspace' ||
          (item.href === '/admin/accounts'
            ? state.viewer.scope.roleCodes.includes('PLATFORM_ADMIN')
            : item.href === '/admin/ingestion'
            ? access.canManage
            : state.capabilities.canView),
      )}
      userDisplayName={state.viewer.displayName}
      userId={state.viewer.userId}
    >
      {children}
    </ShellLayout>
  );
}
