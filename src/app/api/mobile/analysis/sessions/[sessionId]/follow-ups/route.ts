import { NextResponse } from 'next/server';

import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { getRequestSession } from '@/infrastructure/session/server-auth';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import {
  createAnalysisFollowUpUseCases,
  InvalidAnalysisFollowUpQuestionError,
  MissingAnalysisConclusionForFollowUpError,
} from '@/application/follow-up/use-cases';
import { evaluateMobileLightweightFollowUp } from '@/application/mobile-analysis';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const ontologyVersionStore = createPostgresOntologyVersionStore();
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
  ontologyVersionStore,
});
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    ontologyVersionStore,
  });

function buildMobileUrl(request: Request, sessionId: string) {
  return new URL(`/mobile/analysis/${sessionId}`, request.url);
}

function buildPcWorkspaceUrl(sessionId: string) {
  return `/workspace/analysis/${sessionId}`;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const authSession = await getRequestSession();

  if (!authSession) {
    return NextResponse.redirect(
      new URL(`/login?next=/mobile/analysis/${sessionId}`, request.url),
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
  const parentFollowUpId =
    typeof formData.get('parentFollowUpId') === 'string'
      ? String(formData.get('parentFollowUpId')).trim()
      : '';
  const boundary = evaluateMobileLightweightFollowUp({
    questionText,
    pcWorkspaceUrl: buildPcWorkspaceUrl(sessionId),
  });

  if (!boundary.allowed) {
    const url = buildMobileUrl(request, sessionId);
    url.searchParams.set('mobileFollowUpError', boundary.message);
    url.searchParams.set('pcWorkspaceUrl', boundary.pcWorkspaceUrl);

    return NextResponse.redirect(url, { status: 303 });
  }

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const [currentContextReadModel, latestSnapshot, parentFollowUp] =
    await Promise.all([
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
    const url = buildMobileUrl(request, sessionId);
    url.searchParams.set(
      'mobileFollowUpError',
      '当前选中的追问不存在、已失效或无权继续承接。',
    );

    return NextResponse.redirect(url, { status: 303 });
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
      questionText: boundary.normalizedQuestionText,
      currentContextReadModel,
      latestSnapshot,
      baseFollowUp: parentFollowUp,
      baseExecutionSnapshot,
    });
    const url = buildMobileUrl(request, sessionId);
    url.searchParams.set('followUpId', followUp.id);
    url.searchParams.set('mobileFollowUpCreated', '1');

    return NextResponse.redirect(url, { status: 303 });
  } catch (error) {
    const url = buildMobileUrl(request, sessionId);

    if (
      error instanceof InvalidAnalysisFollowUpQuestionError ||
      error instanceof MissingAnalysisConclusionForFollowUpError
    ) {
      url.searchParams.set('mobileFollowUpError', error.message);
    } else {
      url.searchParams.set('mobileFollowUpError', '追问提交失败，请稍后重试。');
    }

    return NextResponse.redirect(url, { status: 303 });
  }
}
