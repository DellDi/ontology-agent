import { NextResponse } from 'next/server';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import {
  createAnalysisFollowUpUseCases,
  InvalidAnalysisFollowUpQuestionError,
  MissingAnalysisConclusionForFollowUpError,
} from '@/application/follow-up/use-cases';
import {
  buildRateLimitRejectedResponse,
  checkRateLimit,
  FOLLOW_UP_RATE_LIMIT,
} from '@/infrastructure/api/rate-limit-middleware';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { ensureRedisConnected, getSharedRedisClient } from '@/infrastructure/redis/client';
import { getRequestSession } from '@/infrastructure/session/server-auth';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
  ontologyVersionStore: createPostgresOntologyVersionStore(),
});
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    ontologyVersionStore: createPostgresOntologyVersionStore(),
  });

function buildSessionUrl(request: Request, sessionId: string) {
  return new URL(`/workspace/analysis/${sessionId}`, request.url);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const authSession = await getRequestSession();

  if (!authSession) {
    return NextResponse.redirect(
      new URL(`/login?next=/workspace/analysis/${sessionId}`, request.url),
      { status: 303 },
    );
  }

  // 限流检查：在触发 LLM 调用前拦截过高频率的请求
  try {
    const { redis } = getSharedRedisClient();
    await ensureRedisConnected(redis);
    const rateResult = await checkRateLimit(redis, FOLLOW_UP_RATE_LIMIT, authSession.userId);

    if (!rateResult.allowed) {
      return buildRateLimitRejectedResponse(request, {
        redirectUrl: buildSessionUrl(request, sessionId),
        errorParamName: 'followUpError',
        rateResult,
      });
    }
  } catch (error) {
    // Redis 不可用时不限流，降级放行；避免缓存故障阻断全部请求
    console.warn('限流检查失败，降级放行:', error);
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

  const formData = await request.formData();
  const questionText =
    typeof formData.get('question') === 'string'
      ? String(formData.get('question'))
      : '';
  const parentFollowUpId =
    typeof formData.get('parentFollowUpId') === 'string'
      ? String(formData.get('parentFollowUpId'))
      : '';

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const [currentContextReadModel, latestSnapshot, parentFollowUp] = await Promise.all([
    analysisContextUseCases.getCurrentContext({
      sessionId: analysisSession.id,
      questionText: analysisSession.questionText,
      savedContext: analysisSession.savedContext,
    }),
    analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
      sessionId: analysisSession.id,
      ownerUserId: authSession.userId,
    }),
    parentFollowUpId
      ? analysisFollowUpUseCases.getOwnedFollowUp({
          followUpId: parentFollowUpId,
          ownerUserId: authSession.userId,
        })
      : Promise.resolve(null),
  ]);

  if (parentFollowUpId && (!parentFollowUp || parentFollowUp.sessionId !== sessionId)) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set(
      'followUpError',
      '当前选中的追问不存在、已失效或无权继续承接。',
    );

    return NextResponse.redirect(url, {
      status: 303,
    });
  }

  try {
    const baseExecutionSnapshot =
      parentFollowUp?.resultExecutionId
        ? await analysisExecutionPersistenceUseCases.getSnapshotByExecutionId({
            executionId: parentFollowUp.resultExecutionId,
            ownerUserId: authSession.userId,
          })
        : null;
    const followUp = await analysisFollowUpUseCases.createFollowUp({
      session: analysisSession,
      questionText,
      currentContextReadModel,
      latestSnapshot,
      baseFollowUp: parentFollowUp,
      baseExecutionSnapshot,
    });
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', followUp.id);

    return NextResponse.redirect(url, {
      status: 303,
    });
  } catch (error) {
    const url = buildSessionUrl(request, sessionId);

    if (
      error instanceof InvalidAnalysisFollowUpQuestionError ||
      error instanceof MissingAnalysisConclusionForFollowUpError
    ) {
      url.searchParams.set('followUpError', error.message);
    } else {
      url.searchParams.set('followUpError', '追问提交失败，请稍后重试。');
    }

    return NextResponse.redirect(url, {
      status: 303,
    });
  }
}
