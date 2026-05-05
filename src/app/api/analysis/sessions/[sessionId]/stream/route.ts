import { NextResponse } from 'next/server';

import {
  createAnalysisExecutionStreamUseCases,
  resolveAnalysisExecutionStreamAccess,
} from '@/application/analysis-execution/stream-use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { withJobUseCases } from '@/infrastructure/job/runtime';
import {
  ensureRedisConnected,
  getSharedRedisClient,
} from '@/infrastructure/redis/client';
import { getRequestSession } from '@/infrastructure/session/server-auth';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
  });

const encoder = new TextEncoder();

function toSseChunk(data: unknown) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function parseAfterSequence(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error('afterSequence 必须是非负整数。');
  }

  return parsed;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const authSession = await getRequestSession();

  if (!authSession) {
    return NextResponse.json({ error: '未登录。' }, { status: 401 });
  }

  const analysisSession = await analysisSessionUseCases.getOwnedSession({
    sessionId,
    owner: authSession,
  });

  if (!analysisSession) {
    return NextResponse.json(
      { error: '会话不存在或无权访问。' },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const executionId = url.searchParams.get('executionId')?.trim();

  if (!executionId) {
    return NextResponse.json(
      { error: 'executionId 不能为空。' },
      { status: 400 },
    );
  }

  let afterSequence = 0;
  try {
    afterSequence = parseAfterSequence(url.searchParams.get('afterSequence'));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'afterSequence 参数无效。',
      },
      { status: 400 },
    );
  }

  const requestedExecutionSnapshot =
    await analysisExecutionPersistenceUseCases.getSnapshotByExecutionId({
      executionId,
      ownerUserId: authSession.userId,
    });
  const requestedExecutionJob = requestedExecutionSnapshot
    ? null
    : await withJobUseCases(async ({ jobUseCases }) =>
        jobUseCases.getJob(executionId),
      );
  const streamAccess = resolveAnalysisExecutionStreamAccess({
    sessionId,
    ownerUserId: authSession.userId,
    executionId,
    snapshot: requestedExecutionSnapshot,
    job: requestedExecutionJob,
  });

  if (!streamAccess.allowed) {
    return NextResponse.json(
      { error: '执行不存在或无权访问。' },
      { status: streamAccess.status },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      let lastSequence = afterSequence;
      const { redis } = getSharedRedisClient();

      try {
        await ensureRedisConnected(redis);
        const analysisExecutionStreamUseCases =
          createAnalysisExecutionStreamUseCases({
            eventStore: createRedisAnalysisExecutionEventStore(redis),
          });

        while (!request.signal.aborted) {
          const events =
            await analysisExecutionStreamUseCases.listExecutionEvents({
              sessionId,
              executionId,
            });

          const pendingEvents = events.filter(
            (event) => event.sequence > lastSequence,
          );

          for (const event of pendingEvents) {
            controller.enqueue(toSseChunk(event));
            lastSequence = event.sequence;
          }

          const terminalEvent = [...events]
            .reverse()
            .find(
              (event) =>
                event.kind === 'execution-status' &&
                (event.status === 'completed' || event.status === 'failed'),
            );

          if (terminalEvent && terminalEvent.sequence <= lastSequence) {
            break;
          }

          await sleep(500);
        }
      } catch (error) {
        controller.enqueue(
          toSseChunk({
            id: 'stream-error',
            kind: 'execution-status',
            executionId,
            sessionId,
            sequence: lastSequence + 1,
            timestamp: new Date().toISOString(),
            status: 'failed',
            message:
              error instanceof Error
                ? error.message
                : '事件流发生未知异常。',
            renderBlocks: [
              {
                type: 'status',
                title: '执行状态',
                value: '已失败',
                tone: 'error',
              },
            ],
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
