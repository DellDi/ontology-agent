import { NextResponse } from 'next/server';

import {
  authorizeGovernanceRequest,
  buildJsonError,
  buildJsonSuccess,
  createRequestCompositionRoot,
} from '../_helpers';

function parseLimit(value: string | null): number {
  if (!value) return 50;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    return 50;
  }
  return parsed;
}

export async function GET(request: Request) {
  const root = await createRequestCompositionRoot();
  const auth = await authorizeGovernanceRequest(root, 'view');
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const { adminUseCases } = root.ontologyAdminRuntime;
  const [records, versions] = await Promise.all([
    adminUseCases.listPublishHistory(limit),
    adminUseCases.listVersions(100),
  ]);

  if (!Array.isArray(records) || !Array.isArray(versions)) {
    return buildJsonError('发布记录读取失败。', 500, 'invalid-read-model');
  }

  return buildJsonSuccess({
    records,
    versions,
    capabilities: auth.capabilities,
  });
}
