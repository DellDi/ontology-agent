import { createCompositionRoot, requireWorkspaceSession } from '@/composition-root';
import {
  createWorkspaceHomeModel,
  type WorkspaceHomeDegradedState,
} from '@/application/workspace/home';

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

type CompositionRoot = ReturnType<typeof createCompositionRoot>;

type FallbackSnapshotEntry = readonly [
  string,
  {
    status: string;
    failurePoint: null;
    conclusionState: null;
    mobileProjection: null;
  },
];

type StreamFallbackResult = {
  entries: FallbackSnapshotEntry[];
  degradedState: WorkspaceHomeDegradedState | null;
};

type StreamFallbackSessionResult = {
  entry: FallbackSnapshotEntry | null;
  degradedState: WorkspaceHomeDegradedState | null;
};

function isFallbackSnapshotEntry(
  entry: FallbackSnapshotEntry | null,
): entry is FallbackSnapshotEntry {
  return entry !== null;
}

async function loadStreamFallbackSnapshots(
  root: CompositionRoot,
  sessionsWithoutSnapshot: { id: string }[],
): Promise<StreamFallbackResult> {
  if (sessionsWithoutSnapshot.length === 0) {
    return { entries: [], degradedState: null };
  }

  try {
    await root.ensureRedisConnected();

    const streamResults = await Promise.all(
      sessionsWithoutSnapshot.map(async (historySession): Promise<StreamFallbackSessionResult> => {
        try {
          const events = await root.analysisExecutionStreamUseCases.listExecutionEvents({
            sessionId: historySession.id,
          });
          const lastStatusEvent = [...events]
            .reverse()
            .find((event) => event.kind === 'execution-status' && event.status);

          if (!lastStatusEvent?.status) {
            return { entry: null, degradedState: null };
          }

          return {
            entry: [
              historySession.id,
              {
                status: lastStatusEvent.status,
                failurePoint: null,
                conclusionState: null,
                mobileProjection: null,
              },
            ] as const,
            degradedState: null,
          };
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : String(error);
          console.warn(
            '[workspace-home] 读取分析 stream 事件失败，将以可视化降级方式继续渲染',
            { sessionId: historySession.id, detail },
          );
          return {
            entry: null,
            degradedState: {
              message: '部分会话状态可能不是最新，建议刷新或稍后重试。',
              source: 'stream-fallback',
              occurredAt: new Date().toISOString(),
            },
          };
        }
      }),
    );

    return {
      entries: streamResults
        .map((result) => result.entry)
        .filter(isFallbackSnapshotEntry),
      degradedState:
        streamResults.find((result) => result.degradedState)?.degradedState ?? null,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    console.warn(
      '[workspace-home] Redis 连接或 stream 兜底失败，进入降级模式',
      { detail },
    );
    return {
      entries: [],
      degradedState: {
        message: '实时数据源暂不可用，部分会话状态可能不是最新。',
        source: 'redis-fallback',
        occurredAt: new Date().toISOString(),
      },
    };
  }
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
  const streamFallbackResult = await loadStreamFallbackSnapshots(
    root,
    sessionsWithoutSnapshot,
  );

  for (const entry of streamFallbackResult.entries) {
    latestSnapshots.set(entry[0], entry[1] as never);
  }

  const model = createWorkspaceHomeModel(
    session,
    historySessions,
    scopedProjects.map((project) => ({
      id: project.id,
      name: project.name,
    })),
    latestSnapshots,
    streamFallbackResult.degradedState,
  );

  return (
    <WorkspaceHomeShell
      model={model}
      creationError={readSearchParam(params.error)}
      draftQuestion={readSearchParam(params.draft)}
    />
  );
}
