import { NextResponse } from 'next/server';

import { auditUseCases } from '@/infrastructure/audit';
import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';

import { authorizeGovernanceRequest, buildRedirect, describeGovernanceError } from '../../../_helpers';

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, ctx: Context) {
  const { id } = await ctx.params;
  const auth = await authorizeGovernanceRequest('author');
  if (auth instanceof NextResponse) return auth;

  const { session } = auth;
  const { governanceUseCases } = getOntologyAdminRuntime();

  try {
    const cr = await governanceUseCases.submitChangeRequest(id);

    await auditUseCases.recordEvent({
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
    params.set('ok', '已提交进入审批。');
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    await auditUseCases.recordEvent({
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
    const params = new URLSearchParams();
    params.set('error', desc.message);
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }
}
