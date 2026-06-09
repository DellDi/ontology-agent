import { NextResponse } from 'next/server';

import {
  InvalidAnalysisQuestionError,
} from '@/application/analysis-session/use-cases';
import {
  createCompositionRoot,
  getRequestSession,
} from '@/composition-root';

function redirectToWorkspace(request: Request, params: URLSearchParams) {
  const url = new URL('/workspace', request.url);
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return NextResponse.redirect(url, {
    status: 303,
  });
}

export async function POST(request: Request) {
  const session = await getRequestSession();
  const root = createCompositionRoot();
  let createdSession:
    | Awaited<ReturnType<typeof root.analysisSessionUseCases.createSession>>
    | null = null;

  if (!session) {
    return NextResponse.redirect(new URL('/login?next=/workspace', request.url), {
      status: 303,
    });
  }

  const formData = await request.formData();
  const questionText =
    typeof formData.get('question') === 'string'
      ? String(formData.get('question'))
      : '';

  try {
    createdSession = await root.analysisSessionUseCases.createSession({
      questionText,
      owner: session,
    });

    await root.analysisIntentUseCases.recognizeAndStoreIntent({
      sessionId: createdSession.id,
      questionText: createdSession.questionText,
    });

    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: createdSession.id,
      eventType: 'analysis.requested',
      eventResult: 'succeeded',
      eventSource: 'route-handler',
      payload: {
        route: '/api/analysis/sessions',
        method: 'POST',
        questionLength: createdSession.questionText.length,
      },
    });

    return NextResponse.redirect(
      new URL(`/workspace/analysis/${createdSession.id}`, request.url),
      {
        status: 303,
      },
    );
  } catch (error) {
    if (session) {
      await root.auditUseCases.recordEvent({
        userId: session.userId,
        organizationId: session.scope.organizationId,
        sessionId: createdSession?.id ?? null,
        eventType: 'analysis.requested',
        eventResult: 'failed',
        eventSource: 'route-handler',
        payload: {
          route: '/api/analysis/sessions',
          method: 'POST',
          reason:
            error instanceof InvalidAnalysisQuestionError
              ? 'invalid-question'
              : 'request-failed',
          questionLength: questionText.trim().length,
        },
      });
    }

    if (!(error instanceof InvalidAnalysisQuestionError) && createdSession) {
      await root.analysisSessionUseCases.deleteOwnedSession({
        sessionId: createdSession.id,
        owner: session,
      });
    }

    const searchParams = new URLSearchParams();

    if (error instanceof InvalidAnalysisQuestionError) {
      searchParams.set('error', error.message);
      if (questionText.trim()) {
        searchParams.set('draft', questionText.trim());
      }
      return redirectToWorkspace(request, searchParams);
    }

    searchParams.set('error', '会话创建失败，请稍后重试。');
    if (questionText.trim()) {
      searchParams.set('draft', questionText.trim());
    }

    return redirectToWorkspace(request, searchParams);
  }
}
