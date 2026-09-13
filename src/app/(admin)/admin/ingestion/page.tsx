import { redirect } from 'next/navigation';

import {
  readJavaBackend,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend/read-client';
import {
  ingestionAccessSchema,
  ingestionOverviewSchema,
  ingestionReleaseTaskListSchema,
} from '@/infrastructure/java-backend/ingestion-schema';
import { IngestionWorkbench } from './ingestion-workbench';

export default async function IngestionPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  let overview;
  let tasks;
  let access;
  try {
    [overview, tasks, access] = await Promise.all([
      readJavaBackend('/api/admin/ingestion/overview', ingestionOverviewSchema),
      readJavaBackend(
        '/api/admin/ingestion/release-tasks',
        ingestionReleaseTaskListSchema,
      ),
      readJavaBackend('/api/admin/ingestion/access', ingestionAccessSchema),
    ]);
  } catch (error) {
    if (error instanceof JavaBackendHttpError) {
      if (error.status === 401) redirect('/login?next=%2Fadmin%2Fingestion');
      if (error.status === 403) {
        return (
          <section className="space-y-3">
            <h1 className="text-2xl font-semibold">数据接入管理访问受限</h1>
            <p className="text-sm text-muted-foreground">
              当前组织尚未获得共享数据源查看权限，请联系平台管理员。
            </p>
          </section>
        );
      }
    }
    throw error;
  }
  return (
    <IngestionWorkbench
      overview={overview}
      access={access}
      releaseTasks={tasks.items}
      initialView={view === 'releases' ? 'releases' : 'publish'}
    />
  );
}
