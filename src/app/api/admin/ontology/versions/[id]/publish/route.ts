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

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request, ctx: Context) {
  const { id } = await ctx.params;

  const root = await createRequestCompositionRoot();
  const auth = await authorizeGovernanceRequest(root, 'publish');
  if (auth instanceof NextResponse) return auth;

  const jsonRequested = wantsJson(request);
  const { session } = auth;
  const formData = await request.formData();
  const publishNote = readString(formData, 'publishNote') || null;

  const { governanceUseCases } = root.ontologyAdminRuntime;

  try {
    const { publishRecord } = await governanceUseCases.publishVersion({
      ontologyVersionId: id,
      publishedBy: session.userId,
      publishNote,
    });

    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.version.published',
      eventResult: 'succeeded',
      eventSource: 'route-handler',
      payload: {
        ontologyVersionId: id,
        publishRecordId: publishRecord.id,
        previousVersionId: publishRecord.previousVersionId,
        changeRequestIds: publishRecord.changeRequestIds,
      },
    });

    const params = new URLSearchParams();
    const message = '版本已发布并切换为当前生效版本。';
    if (jsonRequested) {
      return buildJsonSuccess({
        publishRecord,
        message,
      });
    }
    params.set('ok', message);
    return buildRedirect(request, '/admin/ontology/publishes', params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.version.published',
      eventResult: 'failed',
      eventSource: 'route-handler',
      payload: {
        ontologyVersionId: id,
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
    return buildRedirect(request, '/admin/ontology', params);
  }
}
