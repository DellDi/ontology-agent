import { NextResponse } from 'next/server';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionSubmissionUseCases } from '@/application/analysis-execution/submission-use-cases';
import { InvalidAnalysisExecutionPlanError } from '@/domain/analysis-execution/models';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { analysisIntentUseCases } from '@/infrastructure/analysis-intent';
import { analysisPlanningUseCases } from '@/infrastructure/analysis-planning';
import { factorExpansionUseCases } from '@/infrastructure/factor-expansion';
import { withJobUseCases } from '@/infrastructure/job/runtime';
import { getRequestSession } from '@/infrastructure/session/server-auth';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
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

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const [intent, contextReadModel] = await Promise.all([
    analysisIntentUseCases.getIntentBySessionId(analysisSession.id),
    analysisContextUseCases.getCurrentContext({
      sessionId: analysisSession.id,
      questionText: analysisSession.questionText,
      savedContext: analysisSession.savedContext,
    }),
  ]);

  const candidateFactorReadModel =
    await factorExpansionUseCases.buildCandidateFactorReadModel({
      intentType: intent?.type ?? 'general-analysis',
      questionText: analysisSession.questionText,
      contextReadModel,
    });
  const plan = analysisPlanningUseCases.buildPlan({
    intentType: intent?.type ?? 'general-analysis',
    contextReadModel,
    candidateFactorReadModel,
  });

  try {
    const execution = await withJobUseCases(async (jobUseCases) => {
      const submissionUseCases = createAnalysisExecutionSubmissionUseCases({
        jobUseCases,
      });

      return await submissionUseCases.submitExecution({
        session: analysisSession,
        plan,
      });
    });

    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('executionId', execution.executionId);

    return NextResponse.redirect(url, {
      status: 303,
    });
  } catch (error) {
    const url = buildSessionUrl(request, sessionId);

    if (error instanceof InvalidAnalysisExecutionPlanError) {
      url.searchParams.set('executionError', error.message);
    } else {
      url.searchParams.set('executionError', '执行提交失败，请稍后重试。');
    }

    return NextResponse.redirect(url, {
      status: 303,
    });
  }
}
