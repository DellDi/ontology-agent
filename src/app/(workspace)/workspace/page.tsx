import { redirect } from 'next/navigation';

import {
  createWorkspaceHomeModel,
  type WorkspaceHomeSnapshotSummary,
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

function failurePoint(value: Record<string, unknown> | null) {
  return value && typeof value.title === 'string'
    ? { title: value.title }
    : null;
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

  const latestSnapshots = new Map<string, WorkspaceHomeSnapshotSummary | null>(
    home.sessions.map((session) => {
      const execution = session.latestExecution;
      return [
        session.id,
        execution
          ? {
              executionId: execution.executionId,
              status: execution.status,
              conclusionState: execution.conclusionState,
              failurePoint: failurePoint(execution.failurePoint),
            }
          : null,
      ];
    }),
  );
  const model = createWorkspaceHomeModel(
    home.viewer,
    home.sessions,
    home.projects.map(({ id, name }) => ({ id, name })),
    latestSnapshots,
  );
  const params = (await searchParams) ?? {};
  const errorDetails = [
    readSearchParam(params.error),
    readSearchParam(params.errorCode) && `错误码：${readSearchParam(params.errorCode)}`,
    readSearchParam(params.traceId) && `Trace ID：${readSearchParam(params.traceId)}`,
  ].filter(Boolean).join(' · ');

  return (
    <WorkspaceHomeShell
      model={model}
      creationError={errorDetails}
      draftQuestion={readSearchParam(params.draft)}
    />
  );
}
