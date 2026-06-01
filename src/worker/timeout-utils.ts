// LLM 调用超时工具 — 防止单个步骤的 LLM 调用无限阻塞 worker

/** 单步 LLM 调用默认超时时间（60 秒）。 */
export const LLM_TIMEOUT_MS = 60_000;

export class LLMTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM 调用超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`);
    this.name = 'LLMTimeoutError';
  }
}

/**
 * 为异步调用添加超时保护，并通过 AbortSignal 通知底层取消。
 *
 * 实现策略：
 * 1. **Promise.race** 保证 `callWithTimeout` 本身在超时后立即返回（即使 fn 未响应 signal）
 * 2. **AbortController.abort()** 在超时时触发，通知底层 HTTP 客户端（如 OpenAI SDK）中止请求，
 *    避免 "job 已失败但后续工具又完成" 的混乱事件序列。
 */
export async function callWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = LLM_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new LLMTimeoutError(timeoutMs));
    }, timeoutMs);

    fn(controller.signal).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
