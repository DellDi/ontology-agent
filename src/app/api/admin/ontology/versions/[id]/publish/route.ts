import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, ctx: Context) {
  await ctx.params;
  return forwardJavaBackendRequest(request);
}
