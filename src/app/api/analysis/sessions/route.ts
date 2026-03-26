import { NextResponse } from 'next/server';

import {
  createAnalysisSessionUseCases,
  InvalidAnalysisQuestionError,
} from '@/application/analysis-session/use-cases';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { getRequestSession } from '@/infrastructure/session/server-auth';

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});

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
    const createdSession = await analysisSessionUseCases.createSession({
      questionText,
      owner: session,
    });

    return NextResponse.redirect(
      new URL(`/workspace/analysis/${createdSession.id}`, request.url),
      {
        status: 303,
      },
    );
  } catch (error) {
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
