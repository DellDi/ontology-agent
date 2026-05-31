import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createErpReadUseCases } from '@/application/erp-read/use-cases';
import { createWorkspaceHomeModel } from '@/application/workspace/home';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresErpReadRepository } from '@/infrastructure/erp/postgres-erp-read-repository';
import {
  getSharedRedisClient,
  ensureRedisConnected,
} from '@/infrastructure/redis/client';
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

  // Story 12 fix: 对没有 snapshot 的会话，检查 Redis stream 中的活跃状态作为纠偏。
  // 这解决了 P0-3 极端情况下 snapshot 保存失败导致首页永久显示"待执行"的问题。
  const sessionsWithoutSnapshot = historySessions.filter(
    (s) => !latestSnapshots.get(s.id),
  );
  if (sessionsWithoutSnapshot.length > 0) {
    try {
      const { redis } = getSharedRedisClient();
      await ensureRedisConnected(redis);
      const streamUseCases = createAnalysisExecutionStreamUseCases({
        eventStore: createRedisAnalysisExecutionEventStore(redis),
      });

      const streamEntries = await Promise.all(
        sessionsWithoutSnapshot.map(async (historySession) => {
          try {
            const events = await streamUseCases.listExecutionEvents({
              sessionId: historySession.id,
            });
            if (events.length > 0) {
              // 倒序查找最后一个 execution-status 事件的 status
              // 因为只有 execution-status 事件才有可靠的顶层 status 字段
              // (step-started/tool-started 等事件没有 status)
              const lastStatusEvent = [...events]
                .reverse()
                .find((e) => e.kind === 'execution-status' && e.status);
              if (lastStatusEvent && lastStatusEvent.status) {
                // 构造一个最小 snapshot 用于状态派生
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
            // Redis 不可用或会话无事件，忽略
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
      // Redis 完全不可用，忽略 stream 纠偏
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
