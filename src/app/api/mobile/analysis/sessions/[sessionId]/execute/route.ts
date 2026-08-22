import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

export async function POST(request: Request, context: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await context.params;
  const incoming = new URL(request.url);
  const upstream = new URL(
    `/api/analysis/sessions/${encodeURIComponent(sessionId)}/execute`,
    incoming,
  );
  const proxied = new Request(upstream, {
    method: request.method,
    headers: request.headers,
    body: await request.arrayBuffer(),
  });
  const response = await forwardJavaBackendRequest(proxied);

  if (response.status !== 303) return response;
  const location = response.headers.get('location');
  if (!location) return response;
  const target = new URL(location, incoming);
  target.pathname = `/mobile/analysis/${encodeURIComponent(sessionId)}`;
  const headers = new Headers(response.headers);
  headers.set('location', target.toString());
  return new Response(null, { status: 303, headers });
}
