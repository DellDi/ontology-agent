import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionSubmissionUseCases } from '@/application/analysis-execution/submission-use-cases';
import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import { buildGroundedPlanningArtifacts } from '@/application/ontology/grounded-planning';
import { InvalidAnalysisExecutionPlanError } from '@/domain/analysis-execution/models';
import { resolveOntologyVersionBindingSource } from '@/domain/analysis-execution/persistence-models';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { analysisIntentUseCases } from '@/infrastructure/analysis-intent';
import { createOntologyRuntimeServices } from '@/infrastructure/ontology/runtime';
import { analysisPlanningUseCases } from '@/infrastructure/analysis-planning';
import { factorExpansionUseCases } from '@/infrastructure/factor-expansion';
import { auditUseCases } from '@/infrastructure/audit';
import { withJobUseCases } from '@/infrastructure/job/runtime';
import { getCurrentCorrelationId } from '@/infrastructure/observability';
import { getRequestSession } from '@/infrastructure/session/server-auth';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const ontologyRuntimeServices = createOntologyRuntimeServices();
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
  ontologyVersionStore: ontologyRuntimeServices.versionStore,
});

function buildSessionUrl(request: Request, sessionId: string) {
  return new URL(`/workspace/analysis/${sessionId}`, request.url);
}

async function readOptionalFollowUpId(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';

  if (
    !contentType.includes('multipart/form-data') &&
    !contentType.includes('application/x-www-form-urlencoded')
  ) {
    return '';
  }

  try {
    const formData = await request.formData();

    return typeof formData.get('followUpId') === 'string'
      ? String(formData.get('followUpId'))
      : '';
  } catch {
    return '';
  }
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
    await auditUseCases.recordEvent({
      userId: authSession.userId,
      organizationId: authSession.scope.organizationId,
      sessionId,
      eventType: 'authorization.denied',
      eventResult: 'denied',
      eventSource: 'route-handler',
      payload: {
        route: `/api/analysis/sessions/${sessionId}/execute`,
        method: 'POST',
        reason: 'session-not-accessible',
      },
    });

    return NextResponse.json(
      { error: '会话不存在或无权访问。' },
      { status: 404 },
    );
  }

  const followUpId = await readOptionalFollowUpId(request);

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const [intent, contextReadModel, followUp] = await Promise.all([
    analysisIntentUseCases.getIntentBySessionId(analysisSession.id),
    analysisContextUseCases.getCurrentContext({
      sessionId: analysisSession.id,
      questionText: analysisSession.questionText,
      savedContext: analysisSession.savedContext,
    }),
    followUpId
      ? analysisFollowUpUseCases.getOwnedFollowUp({
          followUpId,
          ownerUserId: authSession.userId,
        })
      : Promise.resolve(null),
  ]);

  if (followUpId && (!followUp || followUp.sessionId !== analysisSession.id)) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('executionError', '当前追问不存在、已失效或无权执行。');
    url.searchParams.set('followUpId', followUpId);

    return NextResponse.redirect(url, {
      status: 303,
    });
  }

  const executionContextReadModel = followUp
    ? {
        sessionId: analysisSession.id,
        version: 0,
        context: followUp.mergedContext,
        canUndo: false,
        originalQuestionText: followUp.questionText,
      }
    : contextReadModel;
  const executionQuestionText = followUp?.questionText ?? analysisSession.questionText;

  const candidateFactorReadModel =
    await factorExpansionUseCases.buildCandidateFactorReadModel({
      intentType: intent?.type ?? 'general-analysis',
      questionText: executionQuestionText,
      contextReadModel: executionContextReadModel,
    });
  const manualFactorLabels = new Set(
    (followUp?.mergedContext.constraints ?? [])
      .filter((constraint) => constraint.label === '候选因素')
      .map((constraint) => constraint.value),
  );
  const mergedCandidateFactorReadModel = followUp
    ? {
        ...candidateFactorReadModel,
        factors: [
          ...(followUp.mergedContext.constraints
            .filter((constraint) => constraint.label === '候选因素')
            .map((constraint, index) => ({
              key: `manual-factor-${index + 1}`,
              label: constraint.value,
              rationale: '用户在 follow-up 中显式补充的候选因素。',
              source: 'manual-follow-up',
            }))),
          ...candidateFactorReadModel.factors.filter(
            (factor) => !manualFactorLabels.has(factor.label),
          ),
        ],
      }
    : candidateFactorReadModel;
  let groundedArtifacts;

  try {
    groundedArtifacts = await buildGroundedPlanningArtifacts({
      sessionId: analysisSession.id,
      ownerUserId: authSession.userId,
      intentType: intent?.type ?? 'general-analysis',
      contextReadModel: executionContextReadModel,
      candidateFactorReadModel: mergedCandidateFactorReadModel,
      groundingUseCases: ontologyRuntimeServices.groundingUseCases,
      groundedContextStore: ontologyRuntimeServices.groundedContextStore,
      analysisPlanningUseCases,
    });
  } catch (error) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set(
      'executionError',
      error instanceof Error ? error.message : '治理化上下文生成失败。',
    );
    if (followUp) {
      url.searchParams.set('followUpId', followUp.id);
    }

    return NextResponse.redirect(url, {
      status: 303,
    });
  }

  try {
    const executionId = randomUUID();
    const execution = await withJobUseCases(async ({
      jobUseCases,
      analysisExecutionStreamUseCases,
    }) => {
      const submissionUseCases = createAnalysisExecutionSubmissionUseCases({
        jobUseCases,
        analysisExecutionStreamUseCases,
        ontologyVersionStore: ontologyRuntimeServices.versionStore,
      });

      return await submissionUseCases.submitExecution({
        session: analysisSession,
        executionId,
        plan: groundedArtifacts.planSnapshot,
        followUpId: followUp?.id ?? null,
        questionText: executionQuestionText,
        context: executionContextReadModel.context,
        groundedContext: groundedArtifacts.groundedContext,
        // Story 7.4 D2: 把当前请求的 correlation id 写入 job payload，
        // worker 消费时恢复到同一条 trace，支撑 AC3 跨进程定位。
        originCorrelationId: getCurrentCorrelationId(),
      });
    });

    if (followUp) {
      await analysisFollowUpUseCases.attachFollowUpExecution({
        followUpId: followUp.id,
        ownerUserId: authSession.userId,
        executionId: execution.executionId,
        ontologyVersionId: groundedArtifacts.groundedContext.ontologyVersionId,
        ontologyVersionSource: resolveOntologyVersionBindingSource(
          followUp.ontologyVersionId,
          groundedArtifacts.groundedContext.ontologyVersionId,
        ),
      });
    }

    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('executionId', execution.executionId);
    if (followUp) {
      url.searchParams.set('followUpId', followUp.id);
    }

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
    if (followUp) {
      url.searchParams.set('followUpId', followUp.id);
    }

    return NextResponse.redirect(url, {
      status: 303,
    });
  }
}
