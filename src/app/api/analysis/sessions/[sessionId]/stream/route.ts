import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

export async function GET(request: Request) {
  return forwardJavaBackendRequest(request);
}
