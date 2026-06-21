import { NextResponse } from 'next/server';

import { validateContextCorrection, ContextCorrectionError } from '@/domain/analysis-context/models';
import {
  createCompositionRoot,
  getRequestSession,
} from '@/composition-root';
import type { CompositionRoot } from '@/composition-root';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

async function resolveOwnerAndSession(root: CompositionRoot, sessionId: string) {
  const authSession = await getRequestSession();

  if (!authSession) {
    return { error: NextResponse.json({ error: '未登录。' }, { status: 401 }) };
  }

  const analysisSession = await root.analysisSessionUseCases.getOwnedSession({
    sessionId,
    owner: authSession,
  });

  if (!analysisSession) {
    return { error: NextResponse.json({ error: '会话不存在或无权访问。' }, { status: 404 }) };
  }

  await root.analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: authSession.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  return { authSession, analysisSession };
}

export async function GET(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const root = createCompositionRoot();
  const resolved = await resolveOwnerAndSession(root, sessionId);

  if ('error' in resolved) {
    return resolved.error;
  }

  const readModel = await root.analysisContextUseCases.getCurrentContext({
    sessionId: resolved.analysisSession.id,
    questionText: resolved.analysisSession.questionText,
    savedContext: resolved.analysisSession.savedContext,
  });

  return NextResponse.json(readModel);
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const root = createCompositionRoot();
  const resolved = await resolveOwnerAndSession(root, sessionId);

  if ('error' in resolved) {
    return resolved.error;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }

  try {
    const correction = validateContextCorrection(body);

    const updated = await root.analysisContextUseCases.correctContext({
      sessionId: resolved.analysisSession.id,
      ownerUserId: resolved.authSession.userId,
      correction,
    });

    await root.analysisSessionUseCases.updateSavedContext({
      sessionId: resolved.analysisSession.id,
      owner: resolved.authSession,
      context: updated.context,
    });

    return NextResponse.json({
      sessionId: updated.sessionId,
      version: updated.version,
      canUndo: updated.version > 1,
      context: updated.context,
      originalQuestionText: updated.originalQuestionText,
    });
  } catch (error) {
    if (error instanceof ContextCorrectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: '修正失败，请稍后重试。' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const root = createCompositionRoot();
  const resolved = await resolveOwnerAndSession(root, sessionId);

  if ('error' in resolved) {
    return resolved.error;
  }

  try {
    const restored = await root.analysisContextUseCases.undoCorrection({
      sessionId: resolved.analysisSession.id,
      ownerUserId: resolved.authSession.userId,
    });

    await root.analysisSessionUseCases.updateSavedContext({
      sessionId: resolved.analysisSession.id,
      owner: resolved.authSession,
      context: restored.context,
    });

    return NextResponse.json({
      sessionId: restored.sessionId,
      version: restored.version,
      canUndo: restored.version > 1,
      context: restored.context,
      originalQuestionText: restored.originalQuestionText,
    });
  } catch (error) {
    if (error instanceof ContextCorrectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: '撤销失败，请稍后重试。' }, { status: 500 });
  }
}
