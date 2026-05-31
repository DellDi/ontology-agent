import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createErpReadUseCases } from '@/application/erp-read/use-cases';
import { createWorkspaceHomeModel } from '@/application/workspace/home';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresErpReadRepository } from '@/infrastructure/erp/postgres-erp-read-repository';
import { requireWorkspaceSession } from '@/infrastructure/session/server-auth';

import { WorkspaceHomeShell } from '../_components/workspace-home-shell';

type WorkspacePageProps = {
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

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const erpReadUseCases = createErpReadUseCases({
  erpReadPort: createPostgresErpReadRepository(),
});
const snapshotStore = createPostgresAnalysisExecutionSnapshotStore();

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const { session, accessDeniedMessage } = await requireWorkspaceSession(
    '/workspace',
  );
  const params = (await searchParams) ?? {};

  if (accessDeniedMessage) {
    return null;
  }

  const historySessions = await analysisSessionUseCases.listOwnedSessions(
    session,
  );
  const scopedProjects = await erpReadUseCases.listProjects(session);

  // 并行获取每条历史会话的最新执行快照
  const snapshotEntries = await Promise.all(
    historySessions.map(async (historySession) => {
      const snapshot = await snapshotStore.getLatestBySessionId(
        historySession.id,
      );
      return [historySession.id, snapshot] as const;
    }),
  );
  const latestSnapshots = new Map(snapshotEntries);

  const model = createWorkspaceHomeModel(
    session,
    historySessions,
    scopedProjects.map((project) => ({
      id: project.id,
      name: project.name,
    })),
    latestSnapshots,
  );

  return (
    <WorkspaceHomeShell
      model={model}
      creationError={readSearchParam(params.error)}
      draftQuestion={readSearchParam(params.draft)}
    />
  );
}
