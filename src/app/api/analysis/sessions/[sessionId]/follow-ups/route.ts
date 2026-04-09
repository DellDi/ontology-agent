import { NextResponse } from 'next/server';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import {
  createAnalysisFollowUpUseCases,
  InvalidAnalysisFollowUpQuestionError,
  MissingAnalysisConclusionForFollowUpError,
} from '@/application/follow-up/use-cases';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { getRequestSession } from '@/infrastructure/session/server-auth';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
});
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
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

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const [currentContextReadModel, latestSnapshot] = await Promise.all([
    analysisContextUseCases.getCurrentContext({
      sessionId: analysisSession.id,
      questionText: analysisSession.questionText,
      savedContext: analysisSession.savedContext,
    }),
    analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
      sessionId: analysisSession.id,
      ownerUserId: authSession.userId,
    }),
  ]);

  try {
    const followUp = await analysisFollowUpUseCases.createFollowUp({
      session: analysisSession,
      questionText,
      currentContextReadModel,
      latestSnapshot,
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
