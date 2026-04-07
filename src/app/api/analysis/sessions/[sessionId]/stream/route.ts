import { NextResponse } from 'next/server';

import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createRedisClient } from '@/infrastructure/redis/client';
import { getRequestSession } from '@/infrastructure/session/server-auth';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});

const encoder = new TextEncoder();

function toSseChunk(data: unknown) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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

  const stream = new ReadableStream({
    async start(controller) {
      let lastSequence = 0;
      const { redis } = createRedisClient();

      try {
        await redis.connect();
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
        await redis.quit();
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
