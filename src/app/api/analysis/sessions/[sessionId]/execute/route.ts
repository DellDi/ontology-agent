import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionSubmissionUseCases } from '@/application/analysis-execution/submission-use-cases';
import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import {
  buildGroundedPlanningArtifacts,
  formatGroundingErrorForUser,
} from '@/application/ontology/grounded-planning';
import { InvalidAnalysisExecutionPlanError } from '@/domain/analysis-execution/models';
import { resolveOntologyVersionBindingSource } from '@/domain/ontology/version-binding';
import {
  buildRateLimitRejectedResponse,
  checkRateLimit,
  EXECUTION_RATE_LIMIT,
} from '@/infrastructure/api/rate-limit-middleware';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { analysisIntentUseCases } from '@/infrastructure/analysis-intent';
import { createOntologyRuntimeServices } from '@/infrastructure/ontology/runtime';
import { analysisPlanningUseCases } from '@/infrastructure/analysis-planning';
import { factorExpansionUseCases } from '@/infrastructure/factor-expansion';
import { getLlmContextExtractionUseCases } from '@/infrastructure/analysis-context-extraction';
import { createPostgresErpReadRepository } from '@/infrastructure/erp/postgres-erp-read-repository';
import { createErpReadUseCases } from '@/application/erp-read/use-cases';
import { auditUseCases } from '@/infrastructure/audit';
import { withJobUseCases } from '@/infrastructure/job/runtime';
import { getCurrentCorrelationId } from '@/infrastructure/observability';
import { ensureRedisConnected, getSharedRedisClient } from '@/infrastructure/redis/client';
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

  // 限流检查：在触发 LLM 调用前拦截过高频率的请求
  try {
    const { redis } = getSharedRedisClient();
    await ensureRedisConnected(redis);
    const rateResult = await checkRateLimit(redis, EXECUTION_RATE_LIMIT, authSession.userId);

    if (!rateResult.allowed) {
      return buildRateLimitRejectedResponse(request, {
        redirectUrl: buildSessionUrl(request, sessionId),
        errorParamName: 'executionError',
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

  // Story 12-4 fix: LLM 抽取必须在主链路真正生效
  // 1. 先用 savedContext 初始化（确保 context store 有 version 1）
  // 2. 再尝试 LLM 抽取，用 replaceInitialContextIfUnmodified 替换
  // 3. 如果 LLM 失败，记录 audit event，用规则抽取继续
  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  try {
    const erpReadUseCases = createErpReadUseCases({
      erpReadPort: createPostgresErpReadRepository(),
    });
    const scopedProjects = await erpReadUseCases.listProjects(authSession);
    const projectNames = scopedProjects
      .filter((p) => authSession.scope.projectIds.includes(p.id))
      .map((p) => p.name);

    const extractionUseCases = getLlmContextExtractionUseCases();
    const extractionResult = await extractionUseCases.extractContext({
      questionText: analysisSession.questionText,
      projectNames,
    });

    if (extractionResult.source !== 'llm') {
      // LLM 抽取失败，extractContext 内部已 catch 并降级到规则抽取。
      // 记录 audit event 用于可观测性，但不替换 context version ——
      // 保留 version 1 (savedContext)，避免系统 fallback 被误认为用户修正。
      const llmIssue = extractionResult.issues.find(
        (issue) => issue.field === 'llm' && issue.severity === 'error',
      );
      await auditUseCases.recordEvent({
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
      // LLM 成功：用抽取结果替换初始上下文（仅在用户未手动修正时）
      await analysisContextUseCases.replaceInitialContextIfUnmodified({
        sessionId: analysisSession.id,
        ownerUserId: authSession.userId,
        questionText: analysisSession.questionText,
        newContext: extractionResult.context,
      });
    }
  } catch (error) {
    // 抽取流程本身抛出未预期异常（非 extractContext 内部降级），记录 audit event
    await auditUseCases.recordEvent({
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
