import { NextResponse } from 'next/server';

import {
  authorizeGovernanceRequest,
  buildJsonError,
  buildJsonSuccess,
  createRequestCompositionRoot,
} from '../../_helpers';

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, ctx: Context) {
  const { id } = await ctx.params;

  const root = await createRequestCompositionRoot();
  const auth = await authorizeGovernanceRequest(root, 'view');
  if (auth instanceof NextResponse) return auth;

  const { adminUseCases } = root.ontologyAdminRuntime;
  const detail = await adminUseCases.getChangeRequestDetail(id);

  if (!detail) {
    return buildJsonError('变更申请不存在。', 404, 'not-found');
  }

  return buildJsonSuccess({
    ...detail,
    capabilities: auth.capabilities,
  });
}
