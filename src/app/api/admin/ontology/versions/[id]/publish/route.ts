import { NextResponse } from 'next/server';

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

  const auth = await authorizeGovernanceRequest('publish');
  if (auth instanceof NextResponse) return auth;

  const { session } = auth;
  const formData = await request.formData();
  const publishNote = readString(formData, 'publishNote') || null;

  const { governanceUseCases } = getOntologyAdminRuntime();

  try {
    const { publishRecord } = await governanceUseCases.publishVersion({
      ontologyVersionId: id,
      publishedBy: session.userId,
      publishNote,
    });

    await auditUseCases.recordEvent({
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
    params.set('ok', '版本已发布并切换为当前生效版本。');
    return buildRedirect(request, '/admin/ontology/publishes', params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    await auditUseCases.recordEvent({
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
    const params = new URLSearchParams();
    params.set('error', desc.message);
    return buildRedirect(request, '/admin/ontology', params);
  }
}
