import { forwardJavaBackendRequest } from '@/infrastructure/java-backend/client';

export async function POST(request: Request) {
  return forwardJavaBackendRequest(request);
}
