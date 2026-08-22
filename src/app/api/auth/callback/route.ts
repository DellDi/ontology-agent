import { NextResponse } from 'next/server';

import { sanitizeNextPath } from '@/domain/auth/models';
import {
  createSessionFromCallback,
  mapAuthErrorToMessage,
} from '@/infrastructure/session/server-auth';

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const { nextPath } = await createSessionFromCallback(url.searchParams);

    return NextResponse.redirect(new URL(nextPath, request.url), {
      status: 303,
    });
  } catch (error) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', mapAuthErrorToMessage(error));

    const nextPath = url.searchParams.get('next');
    if (nextPath?.startsWith('/')) {
      loginUrl.searchParams.set('next', sanitizeNextPath(nextPath));
    }

    return NextResponse.redirect(loginUrl, {
      status: 303,
    });
  }
}
