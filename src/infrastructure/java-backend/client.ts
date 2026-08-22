import 'server-only';

import {
  CORRELATION_HEADER,
  resolveCorrelationIdFromHeaders,
} from '@/infrastructure/observability/correlation';

const REQUEST_HEADERS = [
  'accept',
  'content-type',
  'idempotency-key',
] as const;

const RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'location',
  'retry-after',
  'x-accel-buffering',
  CORRELATION_HEADER,
] as const;

function javaBackendUrl(request: Request) {
  const configured = process.env.JAVA_BACKEND_URL?.trim();
  if (!configured) throw new Error('JAVA_BACKEND_URL 未配置。');
  const incoming = new URL(request.url);
  return new URL(`${incoming.pathname}${incoming.search}`, configured.endsWith('/') ? configured : `${configured}/`);
}

function upstreamHeaders(request: Request, correlationId: string) {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const sessionCookie = request.headers.get('cookie')?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dip3_session='));
  if (sessionCookie) headers.set('cookie', sessionCookie);
  headers.set(CORRELATION_HEADER, correlationId);
  return headers;
}

function downstreamHeaders(upstream: Response) {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export async function forwardJavaBackendRequest(request: Request) {
  const { correlationId } = resolveCorrelationIdFromHeaders(request.headers);
  let upstream: Response;
  try {
    upstream = await fetch(javaBackendUrl(request), {
      method: request.method,
      headers: upstreamHeaders(request, correlationId),
      body: request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Java backend request failed', { correlationId, error });
    return Response.json(
      { error: 'Java 后端不可达。', code: 'JAVA_BACKEND_UNAVAILABLE', traceId: correlationId },
      { status: 502, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: downstreamHeaders(upstream),
  });
}
