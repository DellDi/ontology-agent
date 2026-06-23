import { NextResponse } from 'next/server';

import { APPROVAL_DECISIONS, type ApprovalDecision } from '@/domain/ontology/governance';

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

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request, ctx: Context) {
  const { id } = await ctx.params;

  const root = await createRequestCompositionRoot();
  const auth = await authorizeGovernanceRequest(root, 'review');
  if (auth instanceof NextResponse) return auth;

  const jsonRequested = wantsJson(request);
  const { session } = auth;
  const formData = await request.formData();
  const decision = readString(formData, 'decision') as ApprovalDecision;
  const comment = readString(formData, 'comment');

  if (!APPROVAL_DECISIONS.includes(decision)) {
    if (jsonRequested) {
      return buildJsonError('审批决定无效。', 400, 'invalid-decision');
    }
    const params = new URLSearchParams();
    params.set('error', '审批决定无效。');
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }

  if (!comment) {
    if (jsonRequested) {
      return buildJsonError('请填写审批意见。', 400, 'missing-comment');
    }
    const params = new URLSearchParams();
    params.set('error', '请填写审批意见。');
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  }

  const { governanceUseCases } = root.ontologyAdminRuntime;

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

    await root.auditUseCases.recordEvent({
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
    const message = decision === 'approved' ? '已审批通过。' : '已驳回。';
    if (jsonRequested) {
      return buildJsonSuccess({
        changeRequest: result.changeRequest,
        approvalRecord: result.approvalRecord,
        message,
      });
    }
    params.set('ok', message);
    return buildRedirect(request, `/admin/ontology/change-requests/${id}`, params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    const eventType =
      decision === 'approved'
        ? 'ontology.change_request.approved'
        : 'ontology.change_request.rejected';
    await root.auditUseCases.recordEvent({
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
