import { createCompositionRoot, requireWorkspaceSession } from '@/composition-root';
import { createWorkspaceHomeModel } from '@/application/workspace/home';

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

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const root = createCompositionRoot();
  const { session, accessDeniedMessage } = await requireWorkspaceSession(
    '/workspace',
  );
  const params = (await searchParams) ?? {};

  if (accessDeniedMessage) {
    return null;
  }

  const historySessions = await root.analysisSessionUseCases.listOwnedSessions(
    session,
  );
  const scopedProjects = await root.erpReadUseCases.listProjects(session);

  const snapshotEntries = await Promise.all(
    historySessions.map(async (historySession) => {
      const snapshot = await root.analysisExecutionSnapshotStore.getLatestBySessionId(
        historySession.id,
      );
      return [historySession.id, snapshot] as const;
    }),
  );
  const latestSnapshots = new Map(snapshotEntries);

  const sessionsWithoutSnapshot = historySessions.filter(
    (s) => !latestSnapshots.get(s.id),
  );
  if (sessionsWithoutSnapshot.length > 0) {
    try {
      await root.ensureRedisConnected();

      const streamEntries = await Promise.all(
        sessionsWithoutSnapshot.map(async (historySession) => {
          try {
            const events = await root.analysisExecutionStreamUseCases.listExecutionEvents({
              sessionId: historySession.id,
            });
            if (events.length > 0) {
              const lastStatusEvent = [...events]
                .reverse()
                .find((e) => e.kind === 'execution-status' && e.status);
              if (lastStatusEvent && lastStatusEvent.status) {
                return [
                  historySession.id,
                  {
                    status: lastStatusEvent.status,
                    failurePoint: null,
                    conclusionState: null,
                    mobileProjection: null,
                  },
                ] as const;
              }
            }
          } catch {
          }
          return null;
        }),
      );

      for (const entry of streamEntries) {
        if (entry) {
          latestSnapshots.set(entry[0], entry[1] as never);
        }
      }
    } catch {
    }
  }

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
