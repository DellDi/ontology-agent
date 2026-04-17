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
 * 注意：此端点设计上应受授权边界保护，当前为 MVP 阶段暂对内部暴露，
 * 后续可在 Epic 7 范围内增加 header token 或 IP 白名单。
 */

export async function GET(request: Request) {
  return withRequestObservability(request, 'metrics.snapshot', async () => {
    const snapshot = metrics.snapshot();
    return NextResponse.json(snapshot, { status: 200 });
  });
}
