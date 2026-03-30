import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadLocalEnvFiles(process.cwd());

const shouldRunSmokeTest = process.env.RUN_BAILIAN_SMOKE_TEST === '1';

const smokeTestSkipReason =
  '设置 RUN_BAILIAN_SMOKE_TEST=1 后，才会执行真实百炼 smoke test。';

function loadLocalEnvFiles(cwd: string) {
  for (const filename of ['.env.local', '.env']) {
    const absolutePath = path.join(cwd, filename);

    if (!existsSync(absolutePath)) {
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    console.log('content', content);
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();

      if (!key || process.env[key]) {
        continue;
      }

      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  assert.ok(value, `${name} 必须存在，才能执行真实百炼 smoke test`);

  return value;
}

async function getProviderFactory() {
  const providerModule = await import('../src/infrastructure/llm/openai-compatible-adapter');
  const candidate =
    'createOpenAiCompatibleLlmProvider' in providerModule
      ? providerModule
      : ((providerModule as { default?: Record<string, unknown> }).default ?? {});
  const createProvider = candidate.createOpenAiCompatibleLlmProvider;

  assert.equal(
    typeof createProvider,
    'function',
    '应能从 adapter 模块中解析出 createOpenAiCompatibleLlmProvider',
  );

  return createProvider as typeof import('../src/infrastructure/llm/openai-compatible-adapter').createOpenAiCompatibleLlmProvider;
}

test(
  'Story 4.1 百炼真实配置 smoke test',
  {
    skip: shouldRunSmokeTest ? false : smokeTestSkipReason,
    timeout: 30_000,
  },
  async (t) => {
    getRequiredEnv('DASHSCOPE_API_KEY');
    getRequiredEnv('LLM_PROVIDER_BASE_URL');
    getRequiredEnv('LLM_PROVIDER_MODEL');
    const createOpenAiCompatibleLlmProvider = await getProviderFactory();

    const provider = createOpenAiCompatibleLlmProvider({
      redis: {
        eval: async () => 1,
      } as never,
    });

    await t.test('健康检查可通过', async () => {
      const health = await provider.checkHealth();

      assert.equal(health.ok, true);
      assert.equal(health.provider, 'openai-compatible');
      assert.ok(health.latencyMs >= 0);
      assert.match(health.model, /\S+/);
    });

    await t.test('chat completions 接口可返回非空文本', async () => {
      const result = await provider.createChatCompletion(
        {
          messages: [
            {
              role: 'system',
              content: '你是联调 smoke test 助手。请只输出 SMOKE_OK。',
            },
            {
              role: 'user',
              content: '请只输出 SMOKE_OK',
            },
          ],
        },
        {
          userId: 'smoke-test-user',
          organizationId: 'smoke-test-org',
          purpose: 'bailian-smoke-test',
          timeoutMs: 20_000,
        },
      );

      console.log('result', result);

      assert.match(result.model, /\S+/);
      assert.match(result.text, /SMOKE_OK/i);
      assert.ok(result.raw);
    });
  },
);

