import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const actuatorRequest = new Request(new URL('/actuator/health', incoming), {
    method: 'GET',
    headers: request.headers,
  });
  return forwardJavaBackendRequest(actuatorRequest);
}
