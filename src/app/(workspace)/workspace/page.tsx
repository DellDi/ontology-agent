import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createWorkspaceHomeModel } from '@/application/workspace/home';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { getRequestSession } from '@/infrastructure/session/server-auth';

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

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const session = await getRequestSession();
  const params = (await searchParams) ?? {};

  if (!session) {
    return null;
  }

  const historySessions = await analysisSessionUseCases.listOwnedSessions(
    session.userId,
  );
  const model = createWorkspaceHomeModel(session, historySessions);

  return (
    <WorkspaceHomeShell
      model={model}
      creationError={readSearchParam(params.error)}
      draftQuestion={readSearchParam(params.draft)}
    />
  );
}
