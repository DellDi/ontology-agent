import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

export async function POST(request: Request) {
  return forwardJavaBackendRequest(request);
}
