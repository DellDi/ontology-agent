import { NextResponse } from 'next/server';

import {
  authorizeGovernanceRequest,
  buildJsonError,
  buildJsonSuccess,
  buildRedirect,
  createRequestCompositionRoot,
  describeGovernanceError,
  statusForGovernanceReason,
  wantsJson,
} from '../../../_helpers';

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, ctx: Context) {
  const { id } = await ctx.params;

  const root = await createRequestCompositionRoot();
  const auth = await authorizeGovernanceRequest(root, 'author');
  if (auth instanceof NextResponse) return auth;

  const jsonRequested = wantsJson(request);
  const { session } = auth;
  const { governanceUseCases } = root.ontologyAdminRuntime;

  try {
    const cr = await governanceUseCases.submitChangeRequest(id);

    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.change_request.submitted',
      eventResult: 'succeeded',
      eventSource: 'route-handler',
      payload: {
        action: 'submit',
        changeRequestId: cr.id,
        targetObjectType: cr.targetObjectType,
        targetObjectKey: cr.targetObjectKey,
      },
    });

    const params = new URLSearchParams();
    const message = '已提交进入审批。';
    if (jsonRequested) {
      return buildJsonSuccess({
        changeRequest: cr,
        message,
      });
    }
    params.set('ok', message);
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.change_request.submitted',
      eventResult: 'failed',
      eventSource: 'route-handler',
      payload: {
        action: 'submit',
        changeRequestId: id,
        reason: desc.reason,
      },
    });
    if (jsonRequested) {
      return buildJsonError(
        desc.message,
        statusForGovernanceReason(desc.reason),
        desc.reason,
      );
    }
    const params = new URLSearchParams();
    params.set('error', desc.message);
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }
}
