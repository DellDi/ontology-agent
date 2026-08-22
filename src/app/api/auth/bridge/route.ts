import { NextResponse } from 'next/server';

import { sanitizeNextPath } from '@/domain/auth/models';
import {
  createSessionFromUrlBridge,
  mapDirectoryAuthErrorToMessage,
} from '@/infrastructure/session/server-auth';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const account = url.searchParams.get('account')?.trim() ?? '';
  const next = url.searchParams.get('next');

  if (!account) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'URL 桥接入口缺少 account 参数。');
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  try {
    const { nextPath } = await createSessionFromUrlBridge(account, next);

    return NextResponse.redirect(new URL(nextPath, request.url), {
      status: 303,
    });
  } catch (error) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', mapDirectoryAuthErrorToMessage(error));

    if (next?.startsWith('/')) {
      loginUrl.searchParams.set('next', sanitizeNextPath(next));
    }

    return NextResponse.redirect(loginUrl, { status: 303 });
  }
}
