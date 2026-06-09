import { NextResponse } from 'next/server';

import { isAuditAdmin } from '@/domain/audit/models';
import {
  createCompositionRoot,
  getRequestSession,
} from '@/composition-root';

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? '50', 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 100);
}

export async function GET(request: Request) {
  const session = await getRequestSession();

  if (!session) {
    return NextResponse.json({ error: '未登录。' }, { status: 401 });
  }

  if (!isAuditAdmin(session.scope.roleCodes)) {
    return NextResponse.json({ error: '无权查看审计明细。' }, { status: 403 });
  }

  const root = createCompositionRoot();
  const url = new URL(request.url);
  const items = await root.auditUseCases.listRecentEvents({
    limit: parseLimit(url.searchParams.get('limit')),
  });

  return NextResponse.json(
    {
      items,
    },
    { status: 200 },
  );
}
