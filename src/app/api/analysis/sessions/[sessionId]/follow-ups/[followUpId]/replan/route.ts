import { NextResponse } from 'next/server';

import {
  InvalidAnalysisFollowUpReplanError,
} from '@/application/follow-up/use-cases';
import {
  buildGroundedPlanningArtifacts,
  formatGroundingErrorForUser,
} from '@/application/ontology/grounded-planning';
import {
  createCompositionRoot,
  getRequestSession,
} from '@/composition-root';

type RouteContext = {
  params: Promise<{ sessionId: string; followUpId: string }>;
};

function buildSessionUrl(request: Request, sessionId: string) {
  return new URL(`/workspace/analysis/${sessionId}`, request.url);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { sessionId, followUpId } = await params;
  const authSession = await getRequestSession();

  if (!authSession) {
    return NextResponse.redirect(
      new URL(`/login?next=/workspace/analysis/${sessionId}`, request.url),
      { status: 303 },
    );
  }

  const root = createCompositionRoot();

  const [analysisSession, followUp] = await Promise.all([
    root.analysisSessionUseCases.getOwnedSession({
      sessionId,
      owner: authSession,
    }),
    root.analysisFollowUpUseCases.getOwnedFollowUp({
      followUpId,
      ownerUserId: authSession.userId,
    }),
  ]);

  if (!analysisSession || !followUp || followUp.sessionId !== sessionId) {
    return NextResponse.json(
      { error: '会话不存在、追问不存在或无权访问。' },
      { status: 404 },
    );
  }

  const intent = await root.analysisIntentUseCases.getIntentBySessionId(sessionId);
  const baseSnapshot =
    await root.analysisExecutionPersistenceUseCases.getSnapshotByExecutionId({
      executionId: followUp.referencedExecutionId,
      ownerUserId: authSession.userId,
    });

  const previousPlanSnapshot =
    followUp.currentPlanSnapshot ??
    baseSnapshot?.planSnapshot ??
    null;

  if (!previousPlanSnapshot) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', followUp.id);
    url.searchParams.set('followUpReplanError', '缺少上一轮计划快照，无法重规划。');

    return NextResponse.redirect(url, {
      status: 303,
    });
  }

  const candidateFactorReadModel =
    await root.factorExpansionUseCases.buildCandidateFactorReadModel({
      intentType: intent?.type ?? 'general-analysis',
      questionText: followUp.questionText,
      contextReadModel: {
        sessionId: analysisSession.id,
        version: 0,
        context: followUp.mergedContext,
        canUndo: false,
        originalQuestionText: followUp.questionText,
      },
    });
  const factorConstraints: Array<{
    key: string;
    label: string;
    rationale: string;
    source: string;
  }> = followUp.mergedContext.constraints
    .filter((constraint) => constraint.label === '候选因素')
    .map((constraint, index) => ({
      key: `manual-factor-${index + 1}`,
      label: constraint.value,
      rationale: '用户在 follow-up 中显式补充的候选因素。',
      source: 'manual-follow-up',
    }));

  const manualFactorLabels = new Set(factorConstraints.map((f) => f.label));

  const dedupedFactors = [
    ...factorConstraints,
    ...candidateFactorReadModel.factors.filter(
      (factor) => !manualFactorLabels.has(factor.label),
    ),
  ];
  const followUpContextReadModel = {
    sessionId: analysisSession.id,
    version: 0,
    context: followUp.mergedContext,
    canUndo: false,
    originalQuestionText: followUp.questionText,
  };
  let groundedArtifacts;

  try {
    groundedArtifacts = await buildGroundedPlanningArtifacts({
      sessionId: analysisSession.id,
      ownerUserId: authSession.userId,
      intentType: intent?.type ?? 'general-analysis',
      contextReadModel: followUpContextReadModel,
      candidateFactorReadModel: {
        ...candidateFactorReadModel,
        factors: dedupedFactors,
      },
      groundingUseCases: root.ontologyRuntimeServices.groundingUseCases,
      groundedContextStore: root.ontologyRuntimeServices.groundedContextStore,
      analysisPlanningUseCases: root.analysisPlanningUseCases,
    });
  } catch (error) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', followUp.id);
    url.searchParams.set(
      'followUpReplanError',
      error instanceof Error
        ? formatGroundingErrorForUser(error)
        : '系统暂时无法重新生成执行计划，请稍后重试。',
    );

    return NextResponse.redirect(url, {
      status: 303,
    });
  }

  const reusableCompletedStepIds = [
    ...(baseSnapshot?.stepResults ?? []),
  ]
    .filter((event) => event.step?.status === 'completed')
    .map((event) => event.step?.id)
    .filter((value): value is string => Boolean(value));
  const replanReason = factorConstraints.length > 0
    ? '新增因素条件触发了计划重算。'
    : '用户纠正后的上下文触发了计划重算。';

  try {
    const updatedFollowUp = await root.analysisFollowUpUseCases.updateFollowUpPlan({
      followUp,
      previousPlanSnapshot,
      nextPlanSnapshot: groundedArtifacts.planSnapshot,
      planDiff: root.analysisPlanningUseCases.buildPlanVersionDiff({
        previousPlanSnapshot,
        nextPlanSnapshot: groundedArtifacts.planSnapshot,
        reusableCompletedStepIds,
        reason: replanReason,
      }),
    });
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', updatedFollowUp.id);
    url.searchParams.set('followUpReplanned', 'true');

    return NextResponse.redirect(url, {
      status: 303,
    });
  } catch (error) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', followUp.id);
    url.searchParams.set(
      'followUpReplanError',
      error instanceof InvalidAnalysisFollowUpReplanError
        ? error.message
        : '重规划失败，请稍后重试。',
    );

    return NextResponse.redirect(url, {
      status: 303,
    });
  }
}
