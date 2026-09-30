import { redirect } from 'next/navigation';

import {
  createWorkspaceHomeModel,
  latestExecutionSnapshot,
} from '@/application/workspace/home';
import {
  getWorkspaceHome,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';

import { WorkspaceHomeShell } from '../_components/workspace-home-shell';

type WorkspacePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  let home;
  try {
    home = await getWorkspaceHome();
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      redirect('/login?next=/workspace');
    }
    throw error;
  }

  const latestSnapshots = new Map(
    home.sessions.map((session) => [
      session.id,
      latestExecutionSnapshot(session.latestExecution),
    ]),
  );
  const model = createWorkspaceHomeModel(
    home.viewer,
    home.sessions,
    home.projects.map(({ id, name }) => ({ id, name })),
    latestSnapshots,
    null,
    home.capabilities,
    home.sessionPage,
  );
  const params = (await searchParams) ?? {};
  const errorDetails = readSearchParam(params.error);

  return (
    <WorkspaceHomeShell
      model={model}
      creationError={errorDetails}
      draftQuestion={readSearchParam(params.draft)}
    />
  );
}
