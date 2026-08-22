import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: Context) {
  await context.params;
  return forwardJavaBackendRequest(request);
}
