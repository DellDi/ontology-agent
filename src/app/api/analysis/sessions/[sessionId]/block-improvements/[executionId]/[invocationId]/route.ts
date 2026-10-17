import { forwardJavaBackendRequest } from '@/infrastructure/java-backend/client';

export async function GET(request: Request) {
  return forwardJavaBackendRequest(request);
}
