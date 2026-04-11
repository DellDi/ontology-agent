import { InvalidErpCredentialsError } from '@/domain/auth/errors';

type EncryptResult =
  | { ok: true; encryptedValue: string }
  | { ok: false; reason: string };

export async function encryptPasswordViaErp(
  plainPassword: string,
  erpApiBaseUrl: string,
): Promise<EncryptResult> {
  let response: Response;

  const origin =
    process.env.ERP_API_ORIGIN ?? new URL(erpApiBaseUrl).origin;

  try {
    response = await fetch(`${erpApiBaseUrl}/fastify/newsee/handlePassword`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({
        content: plainPassword,
        isBatch: false,
        aesEnOrDeType: 'encrypt',
      }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : '远端加密接口网络失败。',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `远端加密接口返回 HTTP ${response.status}。`,
    };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: '远端加密接口响应不是合法 JSON。' };
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    (body as Record<string, unknown>).statusCode !== 200 ||
    typeof (body as Record<string, unknown>).result !== 'string' ||
    !(body as Record<string, unknown>).result
  ) {
    return { ok: false, reason: '远端加密接口返回结构不符合预期或 result 为空。' };
  }

  return {
    ok: true,
    encryptedValue: (body as Record<string, string>).result,
  };
}

export function assertEncryptResult(
  result: EncryptResult,
): asserts result is Extract<EncryptResult, { ok: true }> {
  if (!result.ok) {
    throw new InvalidErpCredentialsError('密码验证失败，请稍后重试。');
  }
}
