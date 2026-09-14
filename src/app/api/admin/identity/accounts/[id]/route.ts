import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';
export async function PATCH(request: Request) {
  return forwardJavaBackendRequest(request);
}
