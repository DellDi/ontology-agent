import { NextResponse } from 'next/server';

import {
  metrics,
  withRequestObservability,
} from '@/infrastructure/observability';

/**
 * Story 7.4 Metrics Endpoint。
 *
 * 以 JSON 格式暴露 in-memory counters 与最近错误采样，用于：
 * - 运维团队在控制台直接查看 99.5% 可用性相关的基础计数；
 * - 外部采集器（prometheus json_exporter、自研脚本）拉取后转换。
 *
 * D1 鉴权策略：
 * - `OBSERVABILITY_TOKEN` 未配置 → 视为开发态，允许匿名访问；
 * - 已配置 → 必须在 `x-observability-token` 或 `authorization: Bearer <token>` 中匹配，否则 401；
 * - 错误日志不泄漏 token 内容，仅记录 auth_kind。
 */

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
