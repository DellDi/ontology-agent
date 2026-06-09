import { NextResponse } from 'next/server';

import {
  InvalidAnalysisFollowUpQuestionError,
  MissingAnalysisConclusionForFollowUpError,
} from '@/application/follow-up/use-cases';
import {
  createCompositionRoot,
  getRequestSession,
  checkRateLimit,
  buildRateLimitRejectedResponse,
  FOLLOW_UP_RATE_LIMIT,
} from '@/composition-root';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

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

  const root = createCompositionRoot();

  try {
    await root.ensureRedisConnected();
    const rateResult = await checkRateLimit(root.redisClient.redis, FOLLOW_UP_RATE_LIMIT, authSession.userId);

    if (!rateResult.allowed) {
      return buildRateLimitRejectedResponse(request, {
        redirectUrl: buildSessionUrl(request, sessionId),
        errorParamName: 'followUpError',
        rateResult,
      });
    }
  } catch (error) {
    console.warn('限流检查失败，降级放行:', error);
  }

  const analysisSession = await root.analysisSessionUseCases.getOwnedSession({
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

  await root.analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const [currentContextReadModel, latestSnapshot, parentFollowUp] = await Promise.all([
    root.analysisContextUseCases.getCurrentContext({
      sessionId: analysisSession.id,
      questionText: analysisSession.questionText,
      savedContext: analysisSession.savedContext,
    }),
    root.analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
      sessionId: analysisSession.id,
      ownerUserId: authSession.userId,
    }),
    parentFollowUpId
      ? root.analysisFollowUpUseCases.getOwnedFollowUp({
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
        ? await root.analysisExecutionPersistenceUseCases.getSnapshotByExecutionId({
            executionId: parentFollowUp.resultExecutionId,
            ownerUserId: authSession.userId,
          })
        : null;
    const followUp = await root.analysisFollowUpUseCases.createFollowUp({
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
