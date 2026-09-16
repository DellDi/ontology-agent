/**
 * 对话发送编排：将"发一条消息"映射到后端既有轮次创建/执行链路。
 * 用户侧无感知——创建轮次、按需重生成计划、提交执行三步自动完成，
 * 返回最终应跳转的会话页 URL。
 */

function redirectParam(url: string, key: string): string | null {
  try {
    return new URL(url, window.location.origin).searchParams.get(key);
  } catch {
    return null;
  }
}

function redirectError(url: string, keys: string[]): string | null {
  for (const key of keys) {
    const value = redirectParam(url, key);
    if (value) return value;
  }
  return null;
}

/** 消息轮已创建但尚未执行时，按需重生成计划并提交执行。 */
export async function executePendingFollowUp(
  sessionId: string,
  followUpId: string,
): Promise<string> {
  const detailResp = await fetch(
    `/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}`,
  );
  if (detailResp.ok) {
    const followUp = (await detailResp.json()) as {
      currentPlanSnapshot?: unknown;
      resultExecutionId?: string | null;
    };
    if (followUp.resultExecutionId) {
      return `/workspace/analysis/${sessionId}?executionId=${followUp.resultExecutionId}&followUpId=${followUpId}`;
    }
    if (!followUp.currentPlanSnapshot) {
      const replanResp = await fetch(
        `/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
        { method: 'POST' },
      );
      const replanError = redirectError(replanResp.url, [
        'followUpReplanError',
      ]);
      if (replanError) throw new Error(replanError);
    }
  }

  const executeResp = await fetch(
    `/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      body: new URLSearchParams({ followUpId }),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    },
  );
  const executeError = redirectError(executeResp.url, [
    'followUpExecutionError',
  ]);
  if (executeError) throw new Error(executeError);
  const target = new URL(executeResp.url, window.location.origin);
  if (!target.searchParams.get('executionId')) {
    throw new Error('启动分析失败，请刷新重试。');
  }
  return `${target.pathname}${target.search}`;
}

/** 发送一条新消息：创建轮次 → 自动接力执行 → 返回落地 URL。 */
export async function createFollowUpAndExecute(
  sessionId: string,
  question: string,
): Promise<string> {
  const createResp = await fetch(
    `/api/analysis/sessions/${sessionId}/follow-ups`,
    {
      method: 'POST',
      body: new URLSearchParams({ question }),
    },
  );
  const createError = redirectError(createResp.url, ['followUpError']);
  if (createError) throw new Error(createError);
  const followUpId = redirectParam(createResp.url, 'followUpId');
  if (!followUpId) throw new Error('发送失败，请稍后重试。');
  return executePendingFollowUp(sessionId, followUpId);
}
