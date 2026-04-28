import { NextResponse } from 'next/server';

import { APPROVAL_DECISIONS, type ApprovalDecision } from '@/domain/ontology/governance';
import { auditUseCases } from '@/infrastructure/audit';
import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';

import { authorizeGovernanceRequest, buildRedirect, describeGovernanceError } from '../../../_helpers';

type Context = {
  params: Promise<{ id: string }>;
};

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request, ctx: Context) {
  const { id } = await ctx.params;

  const auth = await authorizeGovernanceRequest('review');
  if (auth instanceof NextResponse) return auth;

  const { session } = auth;
  const formData = await request.formData();
  const decision = readString(formData, 'decision') as ApprovalDecision;
  const comment = readString(formData, 'comment');

  if (!APPROVAL_DECISIONS.includes(decision)) {
    const params = new URLSearchParams();
    params.set('error', '审批决定无效。');
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }

  if (!comment) {
    const params = new URLSearchParams();
    params.set('error', '请填写审批意见。');
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }

  const { governanceUseCases } = getOntologyAdminRuntime();

  try {
    const result = await governanceUseCases.reviewChangeRequest({
      changeRequestId: id,
      decision,
      reviewedBy: session.userId,
      comment,
    });

    const eventType =
      decision === 'approved'
        ? 'ontology.change_request.approved'
        : 'ontology.change_request.rejected';

    await auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType,
      eventResult: 'succeeded',
      eventSource: 'route-handler',
      payload: {
        changeRequestId: id,
        decision,
        approvalRecordId: result.approvalRecord.id,
        targetObjectType: result.changeRequest.targetObjectType,
        targetObjectKey: result.changeRequest.targetObjectKey,
      },
    });

    const params = new URLSearchParams();
    params.set('ok', decision === 'approved' ? '已审批通过。' : '已驳回。');
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    const eventType =
      decision === 'approved'
        ? 'ontology.change_request.approved'
        : 'ontology.change_request.rejected';
    await auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType,
      eventResult: 'failed',
      eventSource: 'route-handler',
      payload: {
        changeRequestId: id,
        decision,
        reason: desc.reason,
      },
    });
    const params = new URLSearchParams();
    params.set('error', desc.message);
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }
}
