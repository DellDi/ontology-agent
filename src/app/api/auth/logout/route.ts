import { NextResponse } from 'next/server';

import { logoutCurrentSession } from '@/infrastructure/session/server-auth';

export async function POST(request: Request) {
  await logoutCurrentSession();

  return NextResponse.redirect(new URL('/login?loggedOut=1', request.url), {
    status: 303,
  });
}
