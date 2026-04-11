import { NextResponse } from 'next/server';

import { getRequestSession } from '@/infrastructure/session/server-auth';

export async function GET() {
  const session = await getRequestSession();

  if (!session) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  return NextResponse.json({
    userId: session.userId,
    displayName: session.displayName,
    scope: session.scope,
  });
}
