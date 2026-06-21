import { NextResponse } from 'next/server';

import {
  buildMetricDictionaryFromOntology,
  buildProjectNameDictionary,
  summarizeOntologyForContextExtraction,
} from '@/application/analysis-context-extraction';
import {
  InvalidAnalysisQuestionError,
} from '@/application/analysis-session/use-cases';
import {
  type CompositionRoot,
  createCompositionRoot,
  getRequestSession,
} from '@/composition-root';
import type { AnalysisSession } from '@/domain/analysis-session/models';
import type { AuthSession } from '@/domain/auth/models';

function redirectToWorkspace(request: Request, params: URLSearchParams) {
  const url = new URL('/workspace', request.url);
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return NextResponse.redirect(url, {
    status: 303,
  });
}

async function recordContextExtractionEvent({
  root,
  authSession,
  analysisSession,
  eventResult,
  payload,
}: {
  root: CompositionRoot;
  authSession: AuthSession;
  analysisSession: AnalysisSession;
  eventResult: 'succeeded' | 'failed';
  payload: Record<string, unknown>;
}) {
  try {
    await root.auditUseCases.recordEvent({
      userId: authSession.userId,
      organizationId: authSession.scope.organizationId,
      sessionId: analysisSession.id,
      eventType: 'tool.invoked',
      eventResult,
      eventSource: 'route-handler',
      payload: {
        route: '/api/analysis/sessions',
        method: 'POST',
        tool: 'llm.context-extraction',
        ...payload,
      },
    });
  } catch (error) {
    console.warn('上下文抽取审计写入失败:', error);
  }
}

async function enrichInitialSavedContext({
  root,
  authSession,
  analysisSession,
}: {
  root: CompositionRoot;
  authSession: AuthSession;
  analysisSession: AnalysisSession;
}) {
  try {
    const [scopedProjects, ontologyDefinitions] = await Promise.all([
      root.erpReadUseCases.listProjects(authSession),
      root.ontologyRuntimeServices.groundingUseCases.getCurrentApprovedDefinitions(),
    ]);
    const projectNames = buildProjectNameDictionary(scopedProjects);
    const metricDictionary =
      buildMetricDictionaryFromOntology(ontologyDefinitions);
    const extractionResult =
      await root.llmContextExtractionUseCases.extractContext({
        questionText: analysisSession.questionText,
        projectNames: projectNames.length > 0 ? projectNames : undefined,
        metricDictionary:
          metricDictionary.length > 0 ? metricDictionary : undefined,
        ontologyVersionSummary:
          summarizeOntologyForContextExtraction(ontologyDefinitions),
      });

    if (extractionResult.source !== 'llm') {
      const llmIssue = extractionResult.issues.find(
        (issue) => issue.field === 'llm' && issue.severity === 'error',
      );
      await recordContextExtractionEvent({
        root,
        authSession,
        analysisSession,
        eventResult: 'failed',
        payload: {
          source: extractionResult.source,
          reason: llmIssue?.message ?? 'LLM 抽取降级到规则引擎',
          fallback: 'rule-based-extraction',
          message: '智能理解服务不可用，已保留基础规则上下文。',
        },
      });
      return;
    }

    const updated = await root.analysisSessionUseCases.updateSavedContext({
      sessionId: analysisSession.id,
      owner: authSession,
      context: extractionResult.context,
    });

    await recordContextExtractionEvent({
      root,
      authSession,
      analysisSession,
      eventResult: updated ? 'succeeded' : 'failed',
      payload: {
        source: extractionResult.source,
        confidence: extractionResult.confidence,
        needsClarification: extractionResult.needsClarification,
        projectDictionarySize: projectNames.length,
        metricDictionarySize: metricDictionary.length,
        persisted: Boolean(updated),
      },
    });
  } catch (error) {
    await recordContextExtractionEvent({
      root,
      authSession,
      analysisSession,
      eventResult: 'failed',
      payload: {
        reason: error instanceof Error ? error.message : '抽取流程异常',
        fallback: 'rule-based-extraction',
        message: '智能理解流程异常，已保留基础规则上下文。',
      },
    });
  }
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

    await enrichInitialSavedContext({
      root,
      authSession: session,
      analysisSession: createdSession,
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
