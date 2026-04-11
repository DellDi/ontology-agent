import { NextResponse } from 'next/server';

import { sanitizeNextPath } from '@/domain/auth/models';
import {
  createSessionFromDirectoryLogin,
  mapDirectoryAuthErrorToMessage,
} from '@/infrastructure/session/server-auth';

export async function POST(request: Request) {
  const formData = await request.formData();

  try {
    const { nextPath } = await createSessionFromDirectoryLogin(formData);

    return NextResponse.redirect(new URL(nextPath, request.url), {
      status: 303,
    });
  } catch (error) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', mapDirectoryAuthErrorToMessage(error));

    const nextPath = formData.get('next');
    if (typeof nextPath === 'string' && nextPath.startsWith('/')) {
      loginUrl.searchParams.set('next', sanitizeNextPath(nextPath));
    }

    const account = formData.get('account');
    if (typeof account === 'string' && account.trim()) {
      loginUrl.searchParams.set('account', account.trim());
    }

    return NextResponse.redirect(loginUrl, {
      status: 303,
    });
  }
}
