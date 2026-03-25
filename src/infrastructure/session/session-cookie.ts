import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE_NAME = 'dip3_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function getSessionSecret() {
  return process.env.SESSION_SECRET || 'dip3-dev-session-secret';
}

function sign(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function createSessionCookieValue(sessionId: string) {
  const payload = Buffer.from(sessionId, 'utf8').toString('base64url');
  const signature = sign(payload);

  return `${payload}.${signature}`;
}

export function readSessionIdFromCookie(cookieValue: string | undefined) {
  if (!cookieValue) {
    return null;
  }

  const [payload, signature] = cookieValue.split('.');

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = sign(payload);
  const isValid =
    signature.length === expectedSignature.length &&
    timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8'),
    );

  if (!isValid) {
    return null;
  }

  return Buffer.from(payload, 'base64url').toString('utf8');
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function getClearedSessionCookieOptions() {
  return {
    ...getSessionCookieOptions(),
    maxAge: 0,
  };
}
