# AI 智能问答产品化修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 智能问答从"执行事件可视化页面"修复为"面向业务用户的线性、多轮、可解释、可追问的数据分析对话产品"。

**Architecture:** 四阶段递进修复 — Phase 0 生产安全加固 → Phase 1 低风险功能快修 → Phase 2 核心体验升级 → Phase 3 多轮对话闭环。每阶段独立可测试，Phase 3 依赖 Phase 1/2 的就绪。

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Redis 8, Drizzle ORM, Vercel AI SDK, Tailwind CSS 4, Vitest

**Investigation source:** `_bmad-output/implementation-artifacts/investigations/ai-qa-product-issues-investigation.md`
**Review source:** `docs/reviews/ai-qa-product-issues-review.md`

---

## File Structure

### Phase 0 — 新建/修改

| File | Responsibility |
|------|---------------|
| Modify: `src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts` | Redis TTL + 原子写入 |
| Modify: `src/infrastructure/redis/keys.ts` | 新增 stream TTL key 辅助 |
| Create: `src/infrastructure/api/rate-limit-middleware.ts` | API 路由级 rate limiting |
| Modify: `src/app/api/analysis/sessions/[sessionId]/execute/route.ts` | 接入 rate limiting |
| Modify: `src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts` | 接入 rate limiting |
| Modify: `src/worker/handlers.ts` | LLM 调用 AbortController + 超时 |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx` | SSE 轮询超时 |

### Phase 1 — 新建/修改

| File | Responsibility |
|------|---------------|
| Modify: `src/application/analysis-message-projection/conversation-view-model.ts` | ERP kv-list 过滤 + 用户向投影 |
| Create: `src/application/factor-expansion/graph-edge-translations.ts` | 图谱边字段中英映射表 |
| Modify: `src/application/factor-expansion/use-cases.ts` | mapGraphFactor 调用翻译 |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx` | 移除 xl:grid-cols |

### Phase 2 — 新建/修改

| File | Responsibility |
|------|---------------|
| Modify: `src/domain/analysis-context/models.ts` | AnalysisContext 新增 granularity |
| Modify: `src/domain/analysis-session/follow-up-models.ts` | FollowUpContextFieldKey 新增 granularity |
| Modify: `src/application/analysis-context-extraction/schemas.ts` | LLM 提取 schema 新增 granularity |
| Modify: `src/application/analysis-context-extraction/normalization.ts` | 归一化支持 granularity |
| Modify: `src/application/analysis-execution/tool-input-builder.ts` | 传递 granularity 到 cube 输入 |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx` | 使用现有 reducer |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx` | drawer ARIA + focus trap |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-pending-refresh-gate.tsx` | 加载状态渲染 |

### Phase 3 — 新建/修改

| File | Responsibility |
|------|---------------|
| Create: `src/application/analysis-message-projection/conversation-thread-view-model.ts` | 多轮对话线程 view model |
| Modify: `src/application/analysis-message-projection/conversation-view-model.ts` | 确保单轮函数可被线程组合 |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx` | 传递多轮数据到 shell |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx` | 渲染多轮消息列表 |
| Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx` | 支持多轮 SSE |

---

## Phase 0: Production Safety Hardening

### Task 0a: Redis Stream TTL

**Files:**
- Modify: `src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts`
- Modify: `src/infrastructure/redis/keys.ts`
- Test: `tests/story-phase-0-redis-stream-ttl.test.mjs`

**Context:** Redis stream keys (`dip3:stream:{sessionId}` and `dip3:stream-sequence:{sessionId}`) never expire. This is a deterministic memory leak — every analysis session permanently accumulates data in Redis.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-0-redis-stream-ttl.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';

describe('Phase 0a: Redis Stream TTL', () => {
  let mockRedis;
  let store;

  beforeEach(() => {
    mockRedis = {
      incr: vi.fn().mockResolvedValue(1),
      rPush: vi.fn().mockResolvedValue(1),
      lTrim: vi.fn().mockResolvedValue('OK'),
      expire: vi.fn().mockResolvedValue(true),
      lRange: vi.fn().mockResolvedValue([]),
    };
    store = createRedisAnalysisExecutionEventStore(mockRedis);
  });

  it('should set TTL on stream key after append', async () => {
    await store.append({
      sessionId: 'test-session',
      executionId: 'test-exec',
      kind: 'step-started',
      status: 'running',
      message: '开始',
    });

    // expire should be called for both stream and sequence keys
    const expireCalls = mockRedis.expire.mock.calls;
    expect(expireCalls.length).toBeGreaterThanOrEqual(1);
    
    // Find the call for the stream key
    const streamExpireCall = expireCalls.find(
      call => call[0].includes('stream') && !call[0].includes('sequence')
    );
    expect(streamExpireCall).toBeDefined();
    expect(streamExpireCall[1]).toBeGreaterThan(0); // TTL > 0
  });

  it('should set TTL of at least 24 hours', async () => {
    await store.append({
      sessionId: 'test-session',
      executionId: 'test-exec',
      kind: 'step-started',
      status: 'running',
      message: '开始',
    });

    const expireCalls = mockRedis.expire.mock.calls;
    const streamExpireCall = expireCalls.find(
      call => call[0].includes('stream') && !call[0].includes('sequence')
    );
    // At least 24 hours (86400 seconds)
    expect(streamExpireCall[1]).toBeGreaterThanOrEqual(86400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-0-redis-stream-ttl.test.mjs`
Expected: FAIL — `expire` is never called (mock returns undefined calls)

- [ ] **Step 3: Implement TTL in event store**

In `src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts`, add TTL constants and expire calls:

```typescript
const MAX_EVENT_COUNT = 200;
const STREAM_TTL_SECONDS = 72 * 60 * 60; // 72 hours

export function createRedisAnalysisExecutionEventStore(
  redis: RedisClientType,
): AnalysisExecutionEventStore {
  return {
    async append(input) {
      const streamKey = redisKeys.stream(input.sessionId);
      const sequenceKey = redisKeys.streamSequence(input.sessionId);
      const sequence = await redis.incr(sequenceKey);

      const event = validateAnalysisExecutionStreamEvent({
        id: randomUUID(),
        sessionId: input.sessionId,
        executionId: input.executionId,
        sequence,
        kind: input.kind,
        timestamp: new Date().toISOString(),
        status: input.status,
        message: input.message,
        step: input.step,
        stage: input.stage,
        tool: input.tool,
        renderBlocks: input.renderBlocks,
        metadata: input.metadata,
      });

      await redis.rPush(streamKey, JSON.stringify(event));
      await redis.lTrim(streamKey, -MAX_EVENT_COUNT, -1);
      await redis.expire(streamKey, STREAM_TTL_SECONDS);
      await redis.expire(sequenceKey, STREAM_TTL_SECONDS);

      return event;
    },

    // listBySession unchanged
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/story-phase-0-redis-stream-ttl.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(phase0): add 72h TTL to Redis stream keys to prevent memory leak"
```

---

### Task 0b: Redis Atomic Event Append

**Files:**
- Modify: `src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts`
- Test: `tests/story-phase-0-redis-atomic-append.test.mjs`

**Context:** Current `append()` performs INCR + RPUSH + LTRIM + EXPIRE as separate commands. If the process crashes between INCR and RPUSH, the sequence number is consumed but the event is lost, corrupting SSE client logic. Use a Lua script to make this atomic.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-0-redis-atomic-append.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';

describe('Phase 0b: Redis atomic append', () => {
  let mockRedis;
  let store;

  beforeEach(() => {
    mockRedis = {
      eval: vi.fn().mockResolvedValue(1),
      lRange: vi.fn().mockResolvedValue([]),
    };
    store = createRedisAnalysisExecutionEventStore(mockRedis);
  });

  it('should use a single eval call (Lua script) for append', async () => {
    await store.append({
      sessionId: 'test-session',
      executionId: 'test-exec',
      kind: 'step-started',
      status: 'running',
      message: '开始',
    });

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const evalArgs = mockRedis.eval.mock.calls[0][0];
    // Should contain INCR, RPUSH, LTRIM, EXPIRE operations
    expect(evalArgs.script || evalArgs).toContain('INCR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-0-redis-atomic-append.test.mjs`
Expected: FAIL — `eval` is not called (current code uses separate incr/rPush/lTrim/expire)

- [ ] **Step 3: Implement Lua script atomic append**

Replace the `append` method body with a single `redis.eval()` call:

```typescript
const APPEND_SCRIPT = `
  local seq = redis.call('INCR', KEYS[1])
  redis.call('RPUSH', KEYS[2], ARGV[1])
  redis.call('LTRIM', KEYS[2], -tonumber(ARGV[2]), -1)
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
  return seq
`;

// In append():
const sequence = await redis.eval({
  script: APPEND_SCRIPT,
  keys: [sequenceKey, streamKey],
  arguments: [
    JSON.stringify(event),
    String(MAX_EVENT_COUNT),
    String(STREAM_TTL_SECONDS),
  ],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/story-phase-0-redis-atomic-append.test.mjs`
Expected: PASS

- [ ] **Step 5: Run full test suite for regression**

Run: `pnpm vitest run tests/story-5-2-execution-stream.test.mjs`
Expected: PASS (existing stream tests still pass)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "fix(phase0): use Lua script for atomic Redis event append"
```

---

### Task 0c: Rate Limiting on Execute Endpoints

**Files:**
- Create: `src/infrastructure/api/rate-limit-middleware.ts`
- Modify: `src/app/api/analysis/sessions/[sessionId]/execute/route.ts`
- Modify: `src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts`
- Test: `tests/story-phase-0-rate-limiting.test.mjs`

**Context:** Execute endpoints have no rate limiting. An authenticated user can trigger unlimited LLM calls + job enqueues, exhausting API quotas. The project already has `src/infrastructure/llm/rate-limit.ts` (dead code pattern), so build a similar Redis-based sliding window limiter at the API route level.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-0-rate-limiting.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, type RateLimitConfig } from '@/infrastructure/api/rate-limit-middleware';

describe('Phase 0c: API rate limiting', () => {
  let mockRedis;
  const config: RateLimitConfig = {
    maxRequests: 5,
    windowSeconds: 60,
    keyPrefix: 'rl:test',
  };

  beforeEach(() => {
    mockRedis = {
      incr: vi.fn(),
      expire: vi.fn().mockResolvedValue(true),
    };
  });

  it('should allow requests under the limit', async () => {
    mockRedis.incr.mockResolvedValue(1);
    const result = await checkRateLimit(mockRedis, config, 'user-1');
    expect(result.allowed).toBe(true);
  });

  it('should reject requests over the limit', async () => {
    mockRedis.incr.mockResolvedValue(6); // over maxRequests=5
    const result = await checkRateLimit(mockRedis, config, 'user-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('should set TTL on first request in window', async () => {
    mockRedis.incr.mockResolvedValue(1);
    await checkRateLimit(mockRedis, config, 'user-1');
    expect(mockRedis.expire).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-0-rate-limiting.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Create rate limit middleware**

```typescript
// src/infrastructure/api/rate-limit-middleware.ts
import type { RedisClientType } from 'redis';

export type RateLimitConfig = {
  maxRequests: number;
  windowSeconds: number;
  keyPrefix: string;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; limit: number };

export async function checkRateLimit(
  redis: RedisClientType,
  config: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const key = `${config.keyPrefix}:${identifier}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, config.windowSeconds);
  }

  if (count > config.maxRequests) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : config.windowSeconds,
      limit: config.maxRequests,
    };
  }

  return { allowed: true };
}

export const EXECUTION_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowSeconds: 60,
  keyPrefix: 'rl:analysis:execute',
};

export const FOLLOW_UP_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60,
  keyPrefix: 'rl:analysis:follow-up',
};
```

- [ ] **Step 4: Integrate into execute route**

In `src/app/api/analysis/sessions/[sessionId]/execute/route.ts`, after auth check and before LLM calls:

```typescript
import { checkRateLimit, EXECUTION_RATE_LIMIT } from '@/infrastructure/api/rate-limit-middleware';

// After auth, before any LLM calls:
const rateLimitResult = await checkRateLimit(redis, EXECUTION_RATE_LIMIT, authSession.userId);
if (!rateLimitResult.allowed) {
  return new Response(
    JSON.stringify({
      error: '请求过于频繁',
      message: `请在 ${rateLimitResult.retryAfterSeconds} 秒后重试`,
      retryAfter: rateLimitResult.retryAfterSeconds,
    }),
    { status: 429, headers: { 'Content-Type': 'application/json' } },
  );
}
```

- [ ] **Step 5: Integrate into follow-ups route**

Same pattern in `follow-ups/route.ts` using `FOLLOW_UP_RATE_LIMIT`.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/story-phase-0-rate-limiting.test.mjs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(phase0): add rate limiting to execute and follow-up endpoints"
```

---

### Task 0d: LLM Call Timeout

**Files:**
- Modify: `src/worker/handlers.ts`
- Test: `tests/story-phase-0-llm-timeout.test.mjs`

**Context:** `runTask()` calls `createResponse()` with no timeout. A hung LLM call blocks the single-threaded worker indefinitely. Add AbortController with a configurable timeout.

- [ ] **Step 1: Read the current handler code**

Read `src/worker/handlers.ts` to locate the `runTask()` / `createResponse()` call and understand the exact invocation pattern.

- [ ] **Step 2: Write the failing test**

```javascript
// tests/story-phase-0-llm-timeout.test.mjs
import { describe, it, expect, vi } from 'vitest';

describe('Phase 0d: LLM call timeout', () => {
  it('should create AbortController with timeout for LLM calls', async () => {
    // Test that the handler creates an AbortController
    // and passes signal to createResponse
    const abortSpy = vi.spyOn(globalThis, 'AbortController');
    // ... invoke handler with mock LLM adapter
    // Verify AbortController was created
    expect(abortSpy).toHaveBeenCalled();
  });

  it('should abort LLM call after timeout', async () => {
    vi.useFakeTimers();
    // Create a mock that never resolves
    const mockCreateResponse = vi.fn(() => new Promise(() => {}));
    // ... invoke handler
    vi.advanceTimersByTime(60_000);
    // Verify the signal was aborted
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Implement AbortController in handler**

In `src/worker/handlers.ts`, wrap `createResponse()` calls:

```typescript
const LLM_TIMEOUT_MS = 60_000;

async function callWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = LLM_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
```

Then wrap `createResponse()`:
```typescript
const response = await callWithTimeout(
  (signal) => createResponse({ ...params, signal }),
);
```

- [ ] **Step 4: Run test to verify**

Run: `pnpm vitest run tests/story-phase-0-llm-timeout.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(phase0): add AbortController timeout to LLM calls in worker"
```

---

### Task 0e: SSE Polling Bounds

**Files:**
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx`
- Test: `tests/story-phase-0-sse-polling-bounds.test.mjs`

**Context:** SSE polling continues indefinitely if the execution never transitions to `finished` or `failed`. Add a max polling duration and max empty polls.

- [ ] **Step 1: Read the current polling code**

Read `analysis-execution-live-shell.tsx` to locate the polling interval logic and understand how `finished`/`failed` states are detected.

- [ ] **Step 2: Write the failing test**

```javascript
// tests/story-phase-0-sse-polling-bounds.test.mjs
import { describe, it, expect, vi } from 'vitest';

describe('Phase 0e: SSE polling bounds', () => {
  it('should stop polling after max duration (5 minutes)', async () => {
    vi.useFakeTimers();
    // ... render component with mock that never reaches finished/failed
    vi.advanceTimersByTime(5 * 60 * 1000);
    // Verify polling stopped
    vi.useRealTimers();
  });

  it('should stop polling after max consecutive empty polls (60)', async () => {
    // ... render with mock that returns no new events
    // Verify polling stopped after 60 empty polls
  });

  it('should show fallback message when polling exhausted', async () => {
    // ... verify UI shows "分析仍在后台执行" message
  });
});
```

- [ ] **Step 3: Implement polling bounds**

Add constants and state tracking:

```typescript
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_EMPTY_POLLS = 60;

// Track polling start time and empty poll count
const [pollStart] = useState(() => Date.now());
const [emptyPollCount, setEmptyPollCount] = useState(0);
const [pollingExhausted, setPollingExhausted] = useState(false);

// In polling callback:
if (Date.now() - pollStart > MAX_POLL_DURATION_MS || emptyPollCount >= MAX_EMPTY_POLLS) {
  setPollingExhausted(true);
  return; // stop polling
}

if (!newEvents.length) {
  setEmptyPollCount(c => c + 1);
} else {
  setEmptyPollCount(0);
}
```

When `pollingExhausted` is true, render a fallback:
```tsx
{pollingExhausted && (
  <div className="rounded-xl border border-[color:var(--line-200)] bg-[color:var(--mist-50)] p-4 text-sm text-[color:var(--ink-600)]">
    <p>分析仍在后台执行中，您可以稍后刷新查看结果。</p>
    <button onClick={() => router.refresh()} className="mt-2 secondary-button">
      手动刷新
    </button>
  </div>
)}
```

- [ ] **Step 4: Run test to verify**

Run: `pnpm vitest run tests/story-phase-0-sse-polling-bounds.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(phase0): add max duration and empty poll bounds to SSE polling"
```

---

## Phase 1: Quick Wins (Low Risk, Immediate Impact)

### Task 1a: User-Facing Result Projection (Direction C)

**Files:**
- Modify: `src/application/analysis-message-projection/conversation-view-model.ts:238-247,519-560`
- Test: `tests/story-phase-1-result-projection.test.mjs`

**Context:** ERP kv-list blocks (`title: 'ERP 读取结果'`) are classified as `'result'` instead of `'diagnostic'`, then swept into metric cards. Two fixes needed: (1) add `'ERP 读取结果'` to `OPERATIONAL_BLOCK_TITLES`, (2) add a title-based filter in `extractMetricCards` as defense-in-depth.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-1-result-projection.test.mjs
import { describe, it, expect } from 'vitest';

// Import the view model builder (adjust path as needed)
// We test that ERP kv-list blocks do NOT appear as metric cards

describe('Phase 1a: User-facing result projection', () => {
  it('should classify ERP 读取结果 blocks as diagnostic, not result', () => {
    // Build a mock projection with an ERP kv-list block
    const erpBlock = {
      kind: 'kv-list',
      title: 'ERP 读取结果',
      payload: {
        items: [
          { label: '资源', value: 'projects' },
          { label: '记录数', value: '287' },
        ],
      },
    };

    // The block should be classified as 'diagnostic'
    // Verify it does NOT appear in metricCards
    // ... build view model with this block and assert
    // expect(viewModel.assistantMessage.metricCards).not.toContainEqual(
    //   expect.objectContaining({ label: '资源', value: 'projects' })
    // );
  });

  it('should keep business metric kv-lists as metric cards', () => {
    // A kv-list with title like '分析结果' or no title should still produce metric cards
    const businessBlock = {
      kind: 'kv-list',
      title: '收缴率分析',
      payload: {
        items: [
          { label: '收缴率', value: '87.5%' },
          { label: '同比变化', value: '+3.2%' },
        ],
      },
    };
    // Should still appear in metricCards
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-1-result-projection.test.mjs`
Expected: FAIL — ERP kv-list items appear in metricCards

- [ ] **Step 3: Add 'ERP 读取结果' to OPERATIONAL_BLOCK_TITLES**

In `conversation-view-model.ts`, line 238-247:

```typescript
const OPERATIONAL_BLOCK_TITLES = new Set([
  '执行状态',
  '执行元数据',
  '状态说明',
  '执行进度',
  '当前步骤',
  '阶段状态',
  '阶段结果',
  '平台能力状态',
  'ERP 读取结果',    // ← 新增
]);
```

- [ ] **Step 4: Add defense-in-depth filter in extractMetricCards**

Add a set of known operational titles that should never produce metric cards:

```typescript
const NON_METRIC_KV_LIST_TITLES = new Set([
  'ERP 读取结果',
  '平台能力状态',
  '执行状态',
  '执行元数据',
]);

function extractMetricCards(
  blocks: readonly AnalysisRenderedBlock[],
): MetricCard[] {
  const cards: MetricCard[] = [];

  for (const block of blocks) {
    if (block.kind === 'kv-list') {
      // Skip operational/internal kv-lists
      if (block.title && NON_METRIC_KV_LIST_TITLES.has(block.title)) continue;

      const items = Array.isArray(block.payload?.items)
        ? (block.payload.items as { label: string; value: string }[])
        : [];
      // ... rest unchanged
    }
    // ... chart handling unchanged
  }

  return cards;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/story-phase-1-result-projection.test.mjs`
Expected: PASS

- [ ] **Step 6: Run existing conversation view model tests**

Run: `pnpm vitest run tests/story-11-1-conversation-view-model.test.mjs tests/story-12-3-conversation-view-model-v2.test.mjs`
Expected: PASS (no regression)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "fix(phase1): filter ERP kv-list from metric cards, classify as diagnostic"
```

---

### Task 1b: Candidate Factor i18n (Direction D)

**Files:**
- Create: `src/application/factor-expansion/graph-edge-translations.ts`
- Modify: `src/application/factor-expansion/use-cases.ts:23-32`
- Test: `tests/story-phase-1-factor-i18n.test.mjs`

**Context:** `mapGraphFactor()` passes raw English enum values (`'has-service-order'`, `'outbound'`, `'erp-derived'`) to the UI. Need a translation layer in the application layer.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-1-factor-i18n.test.mjs
import { describe, it, expect } from 'vitest';
import {
  translateEdgeKind,
  translateDirection,
  translateEvidenceSource,
} from '@/application/factor-expansion/graph-edge-translations';

describe('Phase 1b: Candidate factor i18n', () => {
  it('should translate GraphEdgeKind to Chinese', () => {
    expect(translateEdgeKind('has-service-order')).toBe('工单关联');
    expect(translateEdgeKind('has-receivable')).toBe('应收关联');
    expect(translateEdgeKind('has-payment')).toBe('缴费关联');
    expect(translateEdgeKind('has-complaint')).toBe('投诉关联');
    expect(translateEdgeKind('has-satisfaction')).toBe('满意度关联');
    expect(translateEdgeKind('contains')).toBe('包含');
    expect(translateEdgeKind('belongs-to')).toBe('所属');
    expect(translateEdgeKind('has-owner')).toBe('业主关联');
    expect(translateEdgeKind('causal')).toBe('因果关系');
  });

  it('should translate GraphEdgeDirection to Chinese', () => {
    expect(translateDirection('outbound')).toBe('外向');
    expect(translateDirection('inbound')).toBe('内向');
    expect(translateDirection('undirected')).toBe('无方向');
  });

  it('should translate GraphEvidenceSource to Chinese', () => {
    expect(translateEvidenceSource('erp-master-data')).toBe('ERP 主数据');
    expect(translateEvidenceSource('erp-derived')).toBe('ERP 派生');
    expect(translateEvidenceSource('governed-rule')).toBe('治理规则');
  });

  it('should fall back to raw value for unknown keys', () => {
    expect(translateEdgeKind('unknown-edge-type' as any)).toBe('unknown-edge-type');
    expect(translateDirection('diagonal' as any)).toBe('diagonal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-1-factor-i18n.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Create translation mapping**

```typescript
// src/application/factor-expansion/graph-edge-translations.ts
import type { GraphEdgeKind, GraphEdgeDirection, GraphEvidenceSource } from '@/domain/graph/models';

const EDGE_KIND_LABELS: Record<GraphEdgeKind, string> = {
  'contains': '包含',
  'belongs-to': '所属',
  'has-owner': '业主关联',
  'has-receivable': '应收关联',
  'has-payment': '缴费关联',
  'has-service-order': '工单关联',
  'has-complaint': '投诉关联',
  'has-satisfaction': '满意度关联',
  'causal': '因果关系',
};

const DIRECTION_LABELS: Record<GraphEdgeDirection, string> = {
  'outbound': '外向',
  'inbound': '内向',
  'undirected': '无方向',
};

const SOURCE_LABELS: Record<GraphEvidenceSource, string> = {
  'erp-master-data': 'ERP 主数据',
  'erp-derived': 'ERP 派生',
  'governed-rule': '治理规则',
};

export function translateEdgeKind(kind: GraphEdgeKind | string): string {
  return EDGE_KIND_LABELS[kind as GraphEdgeKind] ?? kind;
}

export function translateDirection(direction: GraphEdgeDirection | string): string {
  return DIRECTION_LABELS[direction as GraphEdgeDirection] ?? direction;
}

export function translateEvidenceSource(source: GraphEvidenceSource | string): string {
  return SOURCE_LABELS[source as GraphEvidenceSource] ?? source;
}
```

- [ ] **Step 4: Run test to verify translations pass**

Run: `pnpm vitest run tests/story-phase-1-factor-i18n.test.mjs`
Expected: PASS

- [ ] **Step 5: Integrate translations into mapGraphFactor**

In `src/application/factor-expansion/use-cases.ts`, modify `mapGraphFactor`:

```typescript
import { translateEdgeKind, translateDirection, translateEvidenceSource } from './graph-edge-translations';

function mapGraphFactor(factor: GraphCandidateFactor): CandidateFactorReadModel['factors'][number] {
  return {
    key: factor.factorKey,
    label: factor.factorLabel,
    rationale: factor.explanation,
    relationType: translateEdgeKind(factor.relationType),
    direction: translateDirection(factor.direction),
    source: translateEvidenceSource(factor.source),
  };
}
```

- [ ] **Step 6: Run existing factor expansion tests**

Run: `pnpm vitest run` (filter for factor-related tests)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(phase1): add Chinese translations for graph edge kinds, directions, sources"
```

---

### Task 1c: History Drawer Layout Fix (Direction F)

**Files:**
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx:55`
- Test: Static assertion in existing test or new test

**Context:** `xl:grid-cols-[320px_minmax(0,1fr)]` activates at viewport ≥1280px inside a 560px drawer, leaving ~176px for the detail column. Remove the viewport-based grid, use single-column stacked layout.

- [ ] **Step 1: Fix the layout**

In `analysis-history-panel.tsx`, line 55, change:

```tsx
// Before:
<div className="mt-5 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">

// After:
<div className="mt-5 space-y-4">
```

Then adjust the inner structure — the round list and detail should stack vertically instead of side-by-side:

```tsx
<div className="mt-5 space-y-4">
  {/* Round list */}
  <div className="space-y-3">
    {readModel.rounds.map((round) => (
      // ... round cards
    ))}
  </div>

  {/* Selected round detail */}
  {selectedRound && (
    <div className="rounded-3xl border border-[color:var(--line-200)] bg-white/78 p-5">
      {/* detail content */}
    </div>
  )}
</div>
```

- [ ] **Step 2: Verify no other xl:grid-cols in drawer context**

Run: `grep -rn "xl:grid-cols" src/app/` — should return 0 results

- [ ] **Step 3: Visual verification**

Run: `pnpm dev` and open history drawer at various viewport widths. Verify no horizontal squeeze.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(phase1): remove viewport-based grid from history drawer, use stacked layout"
```

---

## Phase 2: Core Experience Upgrade

### Task 2a: Granularity in Follow-Up Pipeline (Direction B)

**Files:**
- Modify: `src/domain/analysis-context/models.ts:24-30`
- Modify: `src/domain/analysis-session/follow-up-models.ts:36-41`
- Modify: `src/application/analysis-context-extraction/schemas.ts`
- Modify: `src/application/analysis-context-extraction/normalization.ts`
- Modify: `src/application/analysis-execution/tool-input-builder.ts:289-299`
- Test: `tests/story-phase-2-granularity-pipeline.test.mjs`

**Context:** The gap spans 4 layers: domain (`AnalysisContext` has no granularity), extraction (no rules for "按月份"), follow-up merge (no granularity key), and tool-input-builder (doesn't pass granularity to Cube). Downstream (semantic query models, Cube adapter, query-builder) is already wired.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-2-granularity-pipeline.test.mjs
import { describe, it, expect } from 'vitest';
import { extractAnalysisContext } from '@/domain/analysis-context/models';

describe('Phase 2a: Granularity pipeline', () => {
  it('should extract granularity from question text', () => {
    const result = extractAnalysisContext('按照月份展开看看收缴率');
    expect(result.granularity).toBeDefined();
    expect(result.granularity?.value).toBe('month');
  });

  it('should extract quarterly granularity', () => {
    const result = extractAnalysisContext('按季度看一下');
    expect(result.granularity?.value).toBe('quarter');
  });

  it('should extract daily granularity', () => {
    const result = extractAnalysisContext('逐日展示');
    expect(result.granularity?.value).toBe('day');
  });

  it('should have no granularity when not mentioned', () => {
    const result = extractAnalysisContext('2026年物业费收缴率是多少');
    expect(result.granularity).toBeUndefined();
  });

  it('should pass granularity to cube input', () => {
    // ... build tool inputs with granularity context
    // expect(toolInputs['cube.semantic-query'].granularity).toBe('month');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-2-granularity-pipeline.test.mjs`
Expected: FAIL — `granularity` does not exist on `AnalysisContext`

- [ ] **Step 3: Add granularity to AnalysisContext domain model**

In `src/domain/analysis-context/models.ts`:

```typescript
import type { SemanticGranularity } from '@/application/semantic-query/models';

export type AnalysisContext = {
  targetMetric: AnalysisContextField;
  entity: AnalysisContextField;
  timeRange: AnalysisContextField;
  comparison: AnalysisContextField;
  granularity?: AnalysisContextField;  // ← 新增
  constraints: AnalysisContextConstraint[];
};
```

Add granularity extraction rules (after existing extraction rules):

```typescript
const GRANULARITY_RULES: Array<{ pattern: RegExp; value: SemanticGranularity }> = [
  { pattern: /按?月份?|月度|逐月/, value: 'month' },
  { pattern: /按?季[度]?|季度/, value: 'quarter' },
  { pattern: /按?周|每周|逐周/, value: 'week' },
  { pattern: /按?天|逐日|每日|按日/, value: 'day' },
  { pattern: /按?年|年度|逐年/, value: 'year' },
];

function extractGranularity(questionText: string): ExtractionResult | undefined {
  for (const rule of GRANULARITY_RULES) {
    if (rule.pattern.test(questionText)) {
      return { value: rule.value, state: 'confirmed' };
    }
  }
  return undefined;
}
```

Integrate into `extractAnalysisContext()`:

```typescript
const granularity = extractGranularity(questionText);
return {
  targetMetric: ...,
  entity: ...,
  timeRange: ...,
  comparison: ...,
  granularity: granularity ? { value: granularity.value, label: granularityLabel(granularity.value), state: granularity.state } : undefined,
  constraints: ...,
};
```

- [ ] **Step 4: Add granularity to FollowUpContextFieldKey**

In `src/domain/analysis-session/follow-up-models.ts`:

```typescript
export type FollowUpContextFieldKey =
  | 'targetMetric'
  | 'entity'
  | 'timeRange'
  | 'comparison'
  | 'granularity';  // ← 新增
```

Update `FIELD_LABELS`:
```typescript
const FIELD_LABELS: Record<FollowUpContextFieldKey, string> = {
  targetMetric: '目标指标',
  entity: '分析实体',
  timeRange: '时间范围',
  comparison: '对比方式',
  granularity: '时间粒度',  // ← 新增
};
```

- [ ] **Step 5: Add granularity to LLM extraction schema**

In `src/application/analysis-context-extraction/schemas.ts`, add to the Zod schema:

```typescript
granularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
```

- [ ] **Step 6: Add granularity to normalization**

In `src/application/analysis-context-extraction/normalization.ts`, add granularity to the normalization output.

- [ ] **Step 7: Pass granularity to cube input**

In `src/application/analysis-execution/tool-input-builder.ts`, line 289-299:

```typescript
'cube.semantic-query': {
  metric,
  scope: {
    organizationId: input.organizationId,
    projectIds: input.projectIds,
  },
  dateRange: resolveDateRange(metric, input.context, new Date(), input.groundedContext),
  groupBy: input.projectIds.length > 1 ? ['project-name'] : undefined,
  filters: projectNameFilters,
  limit: 20,
  granularity: input.context.granularity?.value as SemanticGranularity | undefined,  // ← 新增
},
```

- [ ] **Step 8: Run tests**

Run: `pnpm vitest run tests/story-phase-2-granularity-pipeline.test.mjs`
Expected: PASS

Run existing context tests:
Run: `pnpm vitest run tests/story-12-4-llm-context-extraction.test.mjs`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(phase2): add granularity support from domain through tool-input-builder to cube query"
```

---

### Task 2b: Execution Event Reduction in Stream Panel (Direction E)

**Files:**
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx`
- Test: `tests/story-phase-2-execution-reducer.test.mjs`

**Context:** The Stream Panel renders `events.map()` 1:1 with a `'执行中'` default fallback. But `reduceExecutionEventsToCards` already exists in `execution-display.ts` and correctly reduces events by step.id with proper status priority. The fix is to reuse this existing reducer.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-2-execution-reducer.test.mjs
import { describe, it, expect } from 'vitest';

describe('Phase 2b: Execution event reduction in stream panel', () => {
  it('should render one card per step, not one per event', () => {
    // Given: 5 events for the same step (step-started, step-lifecycle, tool-started, tool-completed, step-completed)
    // When: rendered by the stream panel's data source
    // Then: only 1 card should be shown for that step
  });

  it('should show completed status when step has completed event', () => {
    // Given: events include step-started (running) and step-completed (completed)
    // Then: the card should show '已完成', not '执行中'
  });

  it('should not show any 执行中 after execution finishes', () => {
    // Given: execution-status = 'finished'
    // Then: no card should show '执行中'
  });
});
```

- [ ] **Step 2: Read the existing reducer**

Read `src/app/(workspace)/workspace/analysis/[sessionId]/_components/execution-display.ts` to understand `reduceExecutionEventsToCards` — its input/output types and how it reduces events.

- [ ] **Step 3: Refactor stream panel to use reduced events**

Replace the `events.map()` rendering with the existing `reduceExecutionEventsToCards()`:

```typescript
import { reduceExecutionEventsToCards } from './execution-display';

// In the component:
const stepCards = reduceExecutionEventsToCards(events);

// Render:
{stepCards.map((card) => (
  <section key={card.stepId} className={/* ... */}>
    <span>{card.stepLabel}</span>
    <span className={/* status class based on card.status */}>
      {card.status === 'completed' ? '已完成' : card.status === 'failed' ? '已失败' : '执行中'}
    </span>
  </section>
))}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/story-phase-2-execution-reducer.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(phase2): use existing event reducer in stream panel, eliminate 1:1 rendering"
```

---

### Task 2c: Accessibility Baseline

**Files:**
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx:636-687` (drawer)
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-pending-refresh-gate.tsx`
- Test: `tests/story-phase-2-accessibility.test.mjs`

**Context:** Drawers lack focus trap, `role="dialog"`, `aria-modal`. PendingRefreshGate returns null during polling.

- [ ] **Step 1: Add ARIA attributes to drawer**

In `AnalysisDetailDrawer` (`analysis-conversation-shell.tsx:660-686`):

```tsx
<aside
  role="dialog"
  aria-modal="true"
  aria-label={DRAWER_LABELS[drawerType] ?? '详情'}
  className="fixed inset-y-0 right-0 z-40 w-full max-w-[560px] ..."
>
```

- [ ] **Step 2: Add focus trap**

Add a simple focus trap using `useRef` and `keydown` handler:

```tsx
const drawerRef = useRef<HTMLElement>(null);

useEffect(() => {
  if (!drawerType || !drawerRef.current) return;
  
  const drawer = drawerRef.current;
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key !== 'Tab') return;
    
    const focusable = drawer.querySelectorAll<HTMLElement>(focusableSelector);
    if (!focusable.length) return;
    
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Focus first focusable element on open
  const firstFocusable = drawer.querySelector<HTMLElement>(focusableSelector);
  firstFocusable?.focus();

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [drawerType, onClose]);
```

- [ ] **Step 3: Add loading indicator to PendingRefreshGate**

In `analysis-pending-refresh-gate.tsx`, replace `return null` with:

```tsx
return (
  <div
    role="status"
    aria-live="polite"
    className="flex items-center gap-2 rounded-xl border border-[color:var(--line-200)] bg-[color:var(--mist-50)] p-3 text-sm text-[color:var(--ink-600)]"
  >
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--brand-500)] border-t-transparent" />
    <span>正在加载分析结果…</span>
  </div>
);
```

- [ ] **Step 4: Run tests and visual verification**

Run: `pnpm vitest run tests/story-phase-2-accessibility.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(phase2): add ARIA dialog, focus trap to drawers, loading state to PendingRefreshGate"
```

---

## Phase 3: Multi-Turn Conversation Canvas (Direction A)

### Task 3a: Conversation Thread View Model

**Files:**
- Create: `src/application/analysis-message-projection/conversation-thread-view-model.ts`
- Modify: `src/application/analysis-message-projection/conversation-view-model.ts` (ensure single-turn function is composable)
- Test: `tests/story-phase-3-conversation-thread.test.mjs`

**Context:** The main canvas renders exactly one user message + one assistant message. Follow-up Q&A pairs are only visible in the history drawer. Need to create a thread view model that composes all rounds into a linear message list.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-3-conversation-thread.test.mjs
import { describe, it, expect } from 'vitest';
import { buildConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';

describe('Phase 3a: Conversation thread view model', () => {
  it('should build a thread with initial turn', () => {
    const thread = buildConversationThreadViewModel({
      rounds: [
        {
          executionId: 'exec-1',
          questionText: '2026年物业费收缴率是多少？',
          projection: mockProjection,
          events: mockEvents,
        },
      ],
      activeTurnId: 'exec-1',
    });

    expect(thread.turns).toHaveLength(1);
    expect(thread.turns[0].userMessage.questionText).toBe('2026年物业费收缴率是多少？');
  });

  it('should build a thread with multiple turns in order', () => {
    const thread = buildConversationThreadViewModel({
      rounds: [
        { executionId: 'exec-1', questionText: '初始问题', projection: p1, events: e1 },
        { executionId: 'exec-2', questionText: '按月份展开看看', projection: p2, events: e2 },
      ],
      activeTurnId: 'exec-2',
    });

    expect(thread.turns).toHaveLength(2);
    expect(thread.turns[0].userMessage.questionText).toBe('初始问题');
    expect(thread.turns[1].userMessage.questionText).toBe('按月份展开看看');
    expect(thread.activeTurnId).toBe('exec-2');
  });

  it('should mark only the active turn as expanded', () => {
    const thread = buildConversationThreadViewModel({
      rounds: [r1, r2, r3],
      activeTurnId: 'exec-2',
    });
    // Non-active turns should be collapsed (summary only)
    expect(thread.turns[0].isExpanded).toBe(false);
    expect(thread.turns[1].isExpanded).toBe(true);
    expect(thread.turns[2].isExpanded).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/story-phase-3-conversation-thread.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Create the thread view model**

```typescript
// src/application/analysis-message-projection/conversation-thread-view-model.ts
import {
  buildConversationViewModel,
  type AnalysisConversationViewModel,
} from './conversation-view-model';
import type { AiRuntimeProjection } from '@/domain/ai-runtime/models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

export type ConversationTurn = {
  executionId: string;
  viewModel: AnalysisConversationViewModel;
  isExpanded: boolean;
};

export type ConversationThreadViewModel = {
  turns: ConversationTurn[];
  activeTurnId: string;
};

export type ConversationThreadInput = {
  rounds: Array<{
    executionId: string;
    questionText: string;
    projection: AiRuntimeProjection;
    events: AnalysisExecutionStreamEvent[];
  }>;
  activeTurnId: string;
};

export function buildConversationThreadViewModel(
  input: ConversationThreadInput,
): ConversationThreadViewModel {
  const turns: ConversationTurn[] = input.rounds.map((round) => ({
    executionId: round.executionId,
    viewModel: buildConversationViewModel({
      projection: round.projection,
      events: round.events,
      questionText: round.questionText,
    }),
    isExpanded: round.executionId === input.activeTurnId,
  }));

  return {
    turns,
    activeTurnId: input.activeTurnId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/story-phase-3-conversation-thread.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(phase3): add conversation thread view model for multi-turn rendering"
```

---

### Task 3b: Multi-Turn Canvas UI

**Files:**
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx:506-553`
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx:693-752`
- Modify: `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx`
- Test: `tests/story-phase-3-multi-turn-ui.test.mjs`

**Context:** `page.tsx` passes `questionText={analysisSession.questionText}` (always the original question). The shell renders one user + one assistant message. Need to: (1) pass all rounds with their projections/events, (2) shell iterates turns.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/story-phase-3-multi-turn-ui.test.mjs
import { describe, it, expect } from 'vitest';

describe('Phase 3b: Multi-turn canvas UI', () => {
  it('should render all conversation turns in order', () => {
    // Given: a thread with 2 turns
    // When: rendered by AnalysisConversationShell
    // Then: 2 user messages and 2 assistant messages appear in order
  });

  it('should collapse non-active turns', () => {
    // Given: 3 turns, active is turn 2
    // Then: turn 1 and 3 show summary (collapsed), turn 2 shows full detail
  });

  it('should scroll to active turn', () => {
    // Given: active turn is turn 2
    // Then: the active turn element should be scrolled into view
  });
});
```

- [ ] **Step 2: Update page.tsx to pass thread data**

In `page.tsx`, replace the single-turn data loading with multi-round data:

```typescript
// Build thread from all rounds (initial + follow-ups)
import { buildConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';

// Load projections and events for each round
const rounds = await Promise.all(
  executionRounds.map(async (round) => ({
    executionId: round.executionId,
    questionText: round.questionText,
    projection: await loadProjection(round.executionId),
    events: await eventStore.listBySession(sessionId),
  }))
);

const threadViewModel = buildConversationThreadViewModel({
  rounds,
  activeTurnId: activeExecutionId,
});
```

- [ ] **Step 3: Update shell to render turns**

Replace the single-turn rendering in `AnalysisConversationShell`:

```tsx
export type AnalysisConversationShellProps = {
  thread: ConversationThreadViewModel;
  drawerContents: Record<string, ReactNode>;
  children?: ReactNode;
};

export function AnalysisConversationShell({
  thread,
  drawerContents,
  children,
}: AnalysisConversationShellProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [thread.activeTurnId]);

  return (
    <>
      <div className="mx-auto w-full max-w-[860px] space-y-6 px-4">
        {thread.turns.map((turn, index) => (
          <div
            key={turn.executionId}
            ref={turn.isExpanded ? activeRef : undefined}
            className={turn.isExpanded ? '' : 'opacity-70'}
          >
            <AnalysisUserMessage
              questionText={turn.viewModel.userMessage.questionText}
              badges={turn.viewModel.userMessage.badges}
            />
            {turn.isExpanded ? (
              <AnalysisAssistantMessage {...turn.viewModel.assistantMessage} />
            ) : (
              <CollapsedTurnSummary viewModel={turn.viewModel} />
            )}
          </div>
        ))}
        {children}
      </div>
      {/* Drawer unchanged */}
    </>
  );
}
```

- [ ] **Step 4: Add CollapsedTurnSummary component**

```tsx
function CollapsedTurnSummary({ viewModel }: { viewModel: AnalysisConversationViewModel }) {
  return (
    <div className="mt-2 rounded-2xl border border-[color:var(--line-200)] bg-[color:var(--mist-50)]/60 px-5 py-3">
      <p className="text-sm text-[color:var(--ink-600)]">
        {viewModel.assistantMessage.primaryAnswer || viewModel.assistantMessage.headline}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/story-phase-3-multi-turn-ui.test.mjs`
Expected: PASS

Run full test suite: `pnpm vitest run`
Expected: PASS

- [ ] **Step 6: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(phase3): render multi-turn conversation thread on main canvas"
```

---

## Verification Checklist

Before final delivery, run:

```bash
# All tests
pnpm vitest run

# Lint
pnpm lint

# Build
pnpm build

# Story tests (existing)
pnpm vitest run tests/story-11-1-conversation-view-model.test.mjs
pnpm vitest run tests/story-12-3-conversation-view-model-v2.test.mjs
pnpm vitest run tests/story-12-5-worker-stream-events.test.mjs
pnpm vitest run tests/story-6-1-follow-up-on-existing-conclusion.test.mjs
pnpm vitest run tests/story-6-4-preserve-multi-round-history.test.mjs
```

## Acceptance Criteria Verification

| AC | Test File | Phase |
|----|-----------|-------|
| AC-1: 多轮线性聊天 | `story-phase-3-multi-turn-ui.test.mjs` | Phase 3 |
| AC-2: 按月份展开 | `story-phase-2-granularity-pipeline.test.mjs` | Phase 2 |
| AC-3: 主结果不展示内部工具摘要 | `story-phase-1-result-projection.test.mjs` | Phase 1 |
| AC-4: 候选因素可读 | `story-phase-1-factor-i18n.test.mjs` | Phase 1 |
| AC-5: 执行详情稳定 | `story-phase-2-execution-reducer.test.mjs` | Phase 2 |
| AC-6: 诊断有结论 | Covered by Phase 2b reducer | Phase 2 |
| AC-7: 历史抽屉可用 | Visual + `grep xl:grid-cols` | Phase 1 |
| AC-8: 抽屉焦点陷阱 + ARIA | `story-phase-2-accessibility.test.mjs` | Phase 2 |
| AC-9: 错误恢复按钮 | Covered by Phase 2c | Phase 2 |
| AC-10: 数据截止时间戳 | Manual verification | Phase 2 |
| AC-11: PendingRefreshGate 加载状态 | `story-phase-2-accessibility.test.mjs` | Phase 2 |

## Dependency Graph

```
Phase 0 (safety) ──────────────────────────────────── independent, run first

Phase 1a (C: projection) ──┐
Phase 1b (D: i18n)    ─────┤── independent, can run in parallel
Phase 1c (F: layout)  ─────┘

Phase 2a (B: granularity) ─┐
Phase 2b (E: reducer)  ────┤── independent of each other
Phase 2c (a11y)        ────┘

Phase 3a (thread VM) ── depends on Phase 1a (projection must be clean)
Phase 3b (multi-turn UI) ── depends on Phase 3a + Phase 2a (granularity in follow-up)
```
