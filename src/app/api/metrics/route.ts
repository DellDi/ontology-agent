import { NextResponse } from 'next/server';

import {
  metrics,
  withRequestObservability,
} from '@/infrastructure/observability';

const OBSERVABILITY_TOKEN_HEADER = 'x-observability-token';
const AUTH_HEADER = 'authorization';

function extractToken(request: Request): string | null {
  const direct = request.headers.get(OBSERVABILITY_TOKEN_HEADER);
  if (direct) {
    return direct.trim();
  }
  const authorization = request.headers.get(AUTH_HEADER);
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return null;
}

export async function GET(request: Request) {
  return withRequestObservability(request, 'metrics.snapshot', async () => {
    const expectedToken = process.env.OBSERVABILITY_TOKEN;
    if (expectedToken && expectedToken.length > 0) {
      const provided = extractToken(request);
      if (provided !== expectedToken) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 },
        );
      }
    }

    const snapshot = metrics.snapshot();
    return NextResponse.json(snapshot, { status: 200 });
  });
}
