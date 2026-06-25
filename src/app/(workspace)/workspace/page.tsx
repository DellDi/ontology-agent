import { createCompositionRoot, requireWorkspaceSession } from '@/composition-root';
import {
  createWorkspaceHomeModel,
  type WorkspaceHomeDegradedState,
  type WorkspaceHomeSnapshotSummary,
} from '@/application/workspace/home';

import { WorkspaceHomeShell } from '../_components/workspace-home-shell';

type WorkspacePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type WorkspacePerfMeasure = {
  name: string;
  ms: number;
};

const WORKSPACE_PERF_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.WORKSPACE_PERF_LOG === '1';

function createWorkspacePerfLogger() {
  const requestId = Math.random().toString(36).slice(2, 8);
  const startedAt = performance.now();
  const measures: WorkspacePerfMeasure[] = [];

  function record(name: string, started: number) {
    measures.push({
      name,
      ms: Number((performance.now() - started).toFixed(1)),
    });
  }

  return {
    async measure<T>(name: string, run: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        return await run();
      } finally {
        record(name, started);
      }
    },
    measureSync<T>(name: string, run: () => T): T {
      const started = performance.now();
      try {
        return run();
      } finally {
        record(name, started);
      }
    },
    done(extra: Record<string, unknown> = {}) {
      if (!WORKSPACE_PERF_ENABLED) {
        return;
      }

      console.info('[workspace-perf]', {
        requestId,
        totalMs: Number((performance.now() - startedAt).toFixed(1)),
        measures,
        ...extra,
      });
    },
  };
}

type WorkspacePerfLogger = ReturnType<typeof createWorkspacePerfLogger>;

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
  WorkspaceHomeSnapshotSummary,
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
  perf: WorkspacePerfLogger,
): Promise<StreamFallbackResult> {
  if (sessionsWithoutSnapshot.length === 0) {
    return { entries: [], degradedState: null };
  }

  try {
    await root.ensureRedisConnected();

    const streamResults = await Promise.all(
      sessionsWithoutSnapshot.map(async (historySession): Promise<StreamFallbackSessionResult> => {
        try {
          const events = await perf.measure(
            `stream-events:${historySession.id}`,
            () => root.analysisExecutionStreamUseCases.listExecutionEvents({
              sessionId: historySession.id,
            }),
          );
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
                executionId: lastStatusEvent.executionId,
                status: lastStatusEvent.status,
                failurePoint: null,
                conclusionState: { causes: [], renderBlocks: [] },
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
  const perf = createWorkspacePerfLogger();

  try {
    const root = perf.measureSync('createCompositionRoot', () =>
      createCompositionRoot(),
    );
    const { session, accessDeniedMessage } = await perf.measure(
      'requireWorkspaceSession',
      () => requireWorkspaceSession('/workspace'),
    );
    const params = await perf.measure(
      'searchParams',
      async () => (await searchParams) ?? {},
    );

    if (accessDeniedMessage) {
      perf.done({ outcome: 'access-denied' });
      return null;
    }

    const [historySessions, scopedProjects] = await perf.measure(
      'parallel:sessions+projects',
      () => Promise.all([
        perf.measure('listOwnedSessions', () =>
          root.analysisSessionUseCases.listOwnedSessions(session),
        ),
        perf.measure('listProjects', () =>
          root.erpReadUseCases.listProjects(session),
        ),
      ]),
    );

    const latestSnapshotEntries = await perf.measure(
      'getLatestSummariesBySessionIds',
      () => root.analysisExecutionSnapshotStore.getLatestSummariesBySessionIds(
        historySessions.map((historySession) => historySession.id),
      ),
    );
    const latestSnapshots = new Map<string, WorkspaceHomeSnapshotSummary | null>(
      latestSnapshotEntries,
    );

    const sessionsWithoutSnapshot = historySessions.filter(
      (s) => !latestSnapshots.get(s.id),
    );
    const streamFallbackResult = await perf.measure(
      'loadStreamFallbackSnapshots',
      () => loadStreamFallbackSnapshots(root, sessionsWithoutSnapshot, perf),
    );

    for (const entry of streamFallbackResult.entries) {
      latestSnapshots.set(entry[0], entry[1]);
    }

    const model = perf.measureSync('createWorkspaceHomeModel', () =>
      createWorkspaceHomeModel(
        session,
        historySessions,
        scopedProjects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
        latestSnapshots,
        streamFallbackResult.degradedState,
      ),
    );

    perf.done({
      outcome: 'ok',
      historyCount: historySessions.length,
      projectCount: scopedProjects.length,
      snapshotCount: latestSnapshots.size,
      sessionsWithoutSnapshot: sessionsWithoutSnapshot.length,
      degradedSource: streamFallbackResult.degradedState?.source ?? null,
    });

    return (
      <WorkspaceHomeShell
        model={model}
        creationError={readSearchParam(params.error)}
        draftQuestion={readSearchParam(params.draft)}
      />
    );
  } catch (error) {
    perf.done({
      outcome: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
