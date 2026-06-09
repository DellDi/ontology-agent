import { NextResponse } from 'next/server';

import {
  AnalysisFollowUpConflictError,
  InvalidAnalysisFollowUpAdjustmentError,
} from '@/application/follow-up/use-cases';
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

function appendDraftParams(
  url: URL,
  draft: {
    targetMetric?: string;
    entity?: string;
    timeRange?: string;
    comparison?: string;
    factor?: string;
  },
) {
  Object.entries(draft).forEach(([key, value]) => {
    if (value?.trim()) {
      url.searchParams.set(key, value.trim());
    }
  });
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

  const formData = await request.formData();
  const draft = {
    targetMetric:
      typeof formData.get('targetMetric') === 'string'
        ? String(formData.get('targetMetric'))
        : '',
    entity:
      typeof formData.get('entity') === 'string'
        ? String(formData.get('entity'))
        : '',
    timeRange:
      typeof formData.get('timeRange') === 'string'
        ? String(formData.get('timeRange'))
        : '',
    comparison:
      typeof formData.get('comparison') === 'string'
        ? String(formData.get('comparison'))
        : '',
    factor:
      typeof formData.get('factor') === 'string'
        ? String(formData.get('factor'))
        : '',
  };
  const confirmConflicts =
    typeof formData.get('confirmConflicts') === 'string' &&
    String(formData.get('confirmConflicts')) === 'true';

  try {
    const adjustment = root.analysisFollowUpUseCases.validateAdjustmentInput(draft);
    const result = await root.analysisFollowUpUseCases.adjustFollowUpContext({
      followUp,
      adjustment,
      confirmConflicts,
    });
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', result.followUp.id);
    url.searchParams.set(
      'followUpContextUpdated',
      confirmConflicts ? 'conflict-confirmed' : 'true',
    );

    return NextResponse.redirect(url, {
      status: 303,
    });
  } catch (error) {
    const url = buildSessionUrl(request, sessionId);
    url.searchParams.set('followUpId', followUpId);
    appendDraftParams(url, draft);

    if (error instanceof AnalysisFollowUpConflictError) {
      url.searchParams.set(
        'followUpConflict',
        JSON.stringify(error.conflicts),
      );
    } else if (error instanceof InvalidAnalysisFollowUpAdjustmentError) {
      url.searchParams.set('followUpAdjustmentError', error.message);
    } else {
      url.searchParams.set(
        'followUpAdjustmentError',
        '当前轮次上下文更新失败，请稍后重试。',
      );
    }

    return NextResponse.redirect(url, {
      status: 303,
    });
  }
}
