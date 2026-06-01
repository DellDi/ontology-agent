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
 * 为异步调用添加超时保护。
 * 若 `fn` 在 `timeoutMs` 内未完成，返回的 Promise 将以 `LLMTimeoutError` reject。
 */
export async function callWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = LLM_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LLMTimeoutError(timeoutMs));
    }, timeoutMs);

    fn().then(
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
