import type { ReactNode } from 'react';
import {
  getJavaOntologyAdminSessionState,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';
import { readJavaBackend } from '@/infrastructure/java-backend/read-client';
import { ingestionAccessSchema } from '@/infrastructure/java-backend/ingestion-schema';
import { ShellLayout } from '../_components/shell-layout';
import { ADMIN_MENU } from '../_components/shell-menu-config';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  let state;
  let access;
  try {
    [state, access] = await Promise.all([
      getJavaOntologyAdminSessionState(),
      readJavaBackend('/api/admin/ingestion/access', ingestionAccessSchema),
    ]);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401)
      return <>{children}</>;
    throw error;
  }
  return (
    <ShellLayout
      menuItems={ADMIN_MENU.filter(
        (item) =>
          item.href === '/workspace' ||
          (item.href === '/admin/ingestion'
            ? access.canView
            : state.capabilities.canView),
      )}
      userDisplayName={state.viewer.displayName}
      userId={state.viewer.userId}
    >
      {children}
    </ShellLayout>
  );
}
