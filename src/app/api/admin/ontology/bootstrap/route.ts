import { forwardJavaBackendRequest } from '@/infrastructure/java-backend';

export async function GET(request: Request) {
  return forwardJavaBackendRequest(request);
}

export async function POST(request: Request) {
  return forwardJavaBackendRequest(request);
}
