import { NextResponse } from 'next/server';

import {
  createSessionFromLoginForm,
  mapAuthErrorToMessage,
} from '@/infrastructure/session/server-auth';
import { sanitizeNextPath } from '@/domain/auth/models';

export async function POST(request: Request) {
  const formData = await request.formData();

  try {
    const { nextPath } = await createSessionFromLoginForm(formData);

    return NextResponse.redirect(new URL(nextPath, request.url), {
      status: 303,
    });
  } catch (error) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', mapAuthErrorToMessage(error));

    const nextPath = formData.get('next');
    if (typeof nextPath === 'string' && nextPath.startsWith('/')) {
      loginUrl.searchParams.set('next', sanitizeNextPath(nextPath));
    }

    return NextResponse.redirect(loginUrl, {
      status: 303,
    });
  }
}
