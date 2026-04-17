/**
 * Next.js 16 Instrumentation Hook。
 *
 * Story 7.4：在应用启动时统一初始化 observability，
 * 确保服务端入口、后台 worker 与未来的 OTel exporter 共享同一套配置。
 *
 * 当前实现：
 * - 启动一条结构化 info 日志，携带服务元信息，便于日志聚合平台识别启动事件；
 * - 预留 `await import()` 形态的初始化点，未来接入 OTel SDK 只需在此扩展。
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    // Edge runtime 不执行，避免引入 node:async_hooks / pg 依赖。
    return;
  }

  const { rootLogger } = await import('@/infrastructure/observability');
  rootLogger.info('instrumentation.register', {
    service: process.env.OBSERVABILITY_SERVICE_NAME ?? 'ontology-agent-web',
    nodeEnv: process.env.NODE_ENV ?? 'unknown',
    nodeRuntime: process.env.NEXT_RUNTIME,
    startedAt: new Date().toISOString(),
  });
}
