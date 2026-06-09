import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { createAnalysisExecutionSubmissionUseCases } from '@/application/analysis-execution/submission-use-cases';
import {
  buildGroundedPlanningArtifacts,
  formatGroundingErrorForUser,
} from '@/application/ontology/grounded-planning';
import { InvalidAnalysisExecutionPlanError } from '@/domain/analysis-execution/models';
import { resolveOntologyVersionBindingSource } from '@/domain/ontology/version-binding';
import {
  createCompositionRoot,
  getRequestSession,
  getCurrentCorrelationId,
  checkRateLimit,
  buildRateLimitRejectedResponse,
  EXECUTION_RATE_LIMIT,
} from '@/composition-root';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

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

  const root = createCompositionRoot();

  try {
    await root.ensureRedisConnected();
    const rateResult = await checkRateLimit(root.redisClient.redis, EXECUTION_RATE_LIMIT, authSession.userId);

    if (!rateResult.allowed) {
      return buildRateLimitRejectedResponse(request, {
        redirectUrl: buildSessionUrl(request, sessionId),
        errorParamName: 'executionError',
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
    await root.auditUseCases.recordEvent({
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

  await root.analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  try {
    const scopedProjects = await root.erpReadUseCases.listProjects(authSession);
    const projectNames = scopedProjects
      .filter((p) => authSession.scope.projectIds.includes(p.id))
      .map((p) => p.name);

    const extractionResult = await root.llmContextExtractionUseCases.extractContext({
      questionText: analysisSession.questionText,
      projectNames,
    });

    if (extractionResult.source !== 'llm') {
      const llmIssue = extractionResult.issues.find(
        (issue) => issue.field === 'llm' && issue.severity === 'error',
      );
      await root.auditUseCases.recordEvent({
        userId: authSession.userId,
        organizationId: authSession.scope.organizationId,
        sessionId,
        eventType: 'tool.invoked',
        eventResult: 'failed',
        eventSource: 'route-handler',
        payload: {
          tool: 'llm.context-extraction',
          source: extractionResult.source,
          reason: llmIssue?.message ?? 'LLM 抽取降级到规则引擎',
          fallback: 'rule-based-extraction',
          message: '智能理解服务不可用，已使用基础规则继续',
        },
      });
    } else {
      await root.analysisContextUseCases.replaceInitialContextIfUnmodified({
        sessionId: analysisSession.id,
        ownerUserId: authSession.userId,
        questionText: analysisSession.questionText,
        newContext: extractionResult.context,
      });
    }
  } catch (error) {
    await root.auditUseCases.recordEvent({
      userId: authSession.userId,
      organizationId: authSession.scope.organizationId,
      sessionId,
      eventType: 'tool.invoked',
      eventResult: 'failed',
      eventSource: 'route-handler',
      payload: {
        tool: 'llm.context-extraction',
        reason: error instanceof Error ? error.message : '抽取流程异常',
        fallback: 'rule-based-extraction',
        message: '智能理解服务不可用，已使用基础规则继续',
      },
    });
  }

  const [intent, contextReadModel, followUp] = await Promise.all([
    root.analysisIntentUseCases.getIntentBySessionId(analysisSession.id),
    root.analysisContextUseCases.getCurrentContext({
      sessionId: analysisSession.id,
      questionText: analysisSession.questionText,
      savedContext: analysisSession.savedContext,
    }),
    followUpId
      ? root.analysisFollowUpUseCases.getOwnedFollowUp({
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
    await root.factorExpansionUseCases.buildCandidateFactorReadModel({
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

  const replanPlanSnapshot = followUp?.currentPlanSnapshot ?? null;
  const replanGroundedContext = replanPlanSnapshot
    ? await root.ontologyRuntimeServices.groundedContextStore.getLatest(analysisSession.id)
    : null;

  if (replanPlanSnapshot && replanGroundedContext) {
    groundedArtifacts = {
      planSnapshot: replanPlanSnapshot,
      groundedContext: replanGroundedContext,
    };
  } else {
    try {
      groundedArtifacts = await buildGroundedPlanningArtifacts({
        sessionId: analysisSession.id,
        ownerUserId: authSession.userId,
        intentType: intent?.type ?? 'general-analysis',
        contextReadModel: executionContextReadModel,
        candidateFactorReadModel: mergedCandidateFactorReadModel,
        groundingUseCases: root.ontologyRuntimeServices.groundingUseCases,
        groundedContextStore: root.ontologyRuntimeServices.groundedContextStore,
        analysisPlanningUseCases: root.analysisPlanningUseCases,
      });
    } catch (error) {
      const url = buildSessionUrl(request, sessionId);
      url.searchParams.set(
        'executionError',
        error instanceof Error
          ? formatGroundingErrorForUser(error)
          : '系统暂时无法生成执行计划，请稍后重试。',
      );
      if (followUp) {
        url.searchParams.set('followUpId', followUp.id);
      }

      return NextResponse.redirect(url, {
        status: 303,
      });
    }
  }

  try {
    const executionId = randomUUID();
    const execution = await root.withJobUseCases(async ({
      jobUseCases,
      analysisExecutionStreamUseCases,
    }) => {
      const submissionUseCases = createAnalysisExecutionSubmissionUseCases({
        jobUseCases,
        analysisExecutionStreamUseCases,
        ontologyVersionStore: root.ontologyRuntimeServices.versionStore,
      });

      return await submissionUseCases.submitExecution({
        session: analysisSession,
        executionId,
        plan: groundedArtifacts.planSnapshot,
        followUpId: followUp?.id ?? null,
        questionText: executionQuestionText,
        context: executionContextReadModel.context,
        groundedContext: groundedArtifacts.groundedContext,
        candidateFactors: mergedCandidateFactorReadModel.factors.map(
          (factor) => ({
            key: factor.key,
            label: factor.label,
          }),
        ),
        originCorrelationId: getCurrentCorrelationId(),
      });
    });

    if (followUp) {
      await root.analysisFollowUpUseCases.attachFollowUpExecution({
        followUpId: followUp.id,
        ownerUserId: authSession.userId,
        executionId: execution.executionId,
        ontologyVersionId: groundedArtifacts.groundedContext.ontologyVersionId,
        ontologyVersionBindingSource: resolveOntologyVersionBindingSource({
          previousOntologyVersionId: followUp.ontologyVersionId,
          nextOntologyVersionId: groundedArtifacts.groundedContext.ontologyVersionId,
        }),
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
