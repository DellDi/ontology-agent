import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LIVE_SHELL_PATH =
  'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx';
const STREAM_HOOK_PATH =
  'src/app/(workspace)/workspace/analysis/[sessionId]/_hooks/use-analysis-execution-stream.ts';

function readLiveShellSource() {
  return readFileSync(LIVE_SHELL_PATH, 'utf-8');
}

function readStreamHookSource() {
  return readFileSync(STREAM_HOOK_PATH, 'utf-8');
}

// ---------------------------------------------------------------------------
// Phase 0e: SSE polling bounds — 最大连接时长保护与断流恢复入口
// ---------------------------------------------------------------------------

test('Phase 0e | SSE_MAX_DURATION_MS 常量应为 5 分钟 (5 * 60 * 1000)', () => {
  const source = readStreamHookSource();
  assert.ok(
    source.includes('SSE_MAX_DURATION_MS'),
    '应声明 SSE_MAX_DURATION_MS 常量',
  );
  assert.ok(
    source.includes('5 * 60 * 1000'),
    'SSE_MAX_DURATION_MS 应为 5 * 60 * 1000 (5 分钟)',
  );
});

test('Phase 0e | useEffect 中应使用 setTimeout 设置最大连接时长定时器', () => {
  const source = readStreamHookSource();
  assert.ok(
    source.includes('setTimeout('),
    '应调用 setTimeout 以设置最大连接时长定时器',
  );
  assert.ok(
    source.includes('maxDurationTimer'),
    '应将 setTimeout 返回值赋给 maxDurationTimer',
  );
  assert.ok(
    source.includes('SSE_MAX_DURATION_MS'),
    'setTimeout 应使用 SSE_MAX_DURATION_MS 作为延迟时间',
  );
});

test('Phase 0e | 正常完成 / 失败时应 clearTimeout(maxDurationTimer)', () => {
  const source = readStreamHookSource();
  // 在 onmessage 中完成 / 失败分支里应清理定时器
  assert.ok(
    source.includes('clearTimeout(maxDurationTimer)'),
    '应在执行完成/失败及 cleanup 中调用 clearTimeout(maxDurationTimer)',
  );

  // 至少出现 3 次：onmessage 完成分支、onerror 分支、cleanup 函数
  const matches = source.match(/clearTimeout\(maxDurationTimer\)/g) ?? [];
  assert.ok(
    matches.length >= 3,
    `clearTimeout(maxDurationTimer) 应至少出现 3 次（完成/onerror/cleanup），实际出现 ${matches.length} 次`,
  );
});

test('Phase 0e | cleanup 函数应同时清理定时器和关闭 EventSource', () => {
  const source = readStreamHookSource();
  // cleanup 中应同时包含 clearTimeout 和 eventSource.close
  const cleanupBlockPattern = /return\s*\(\)\s*=>\s*\{[\s\S]*?clearTimeout\(maxDurationTimer\)[\s\S]*?eventSource\.close\(\)[\s\S]*?\}/;
  assert.ok(
    cleanupBlockPattern.test(source),
    'cleanup 函数应先 clearTimeout 再 eventSource.close()',
  );
});

test('Phase 0e | 超时后应设置 streamConnectionIssue 并携带超时提示文案', () => {
  const source = readStreamHookSource();
  // 在 setTimeout 回调中应调用 setStreamConnectionIssue
  assert.ok(
    source.includes('分析执行时间较长，实时流已超时'),
    '超时提示文案应包含"分析执行时间较长，实时流已超时"',
  );
});

test('Phase 0e | 应渲染"重新连接"按钮以支持手动重连', () => {
  const shellSource = readLiveShellSource();
  const hookSource = readStreamHookSource();
  assert.ok(
    shellSource.includes('重新连接'),
    'UI 中应包含"重新连接"按钮文案',
  );
  assert.ok(
    hookSource.includes('const reconnect = useCallback(') &&
      hookSource.includes('setReconnectEpoch'),
    '应定义 reconnect 回调以处理重连逻辑',
  );
});

test('Phase 0e | 应渲染"手动刷新"按钮并调用 router.refresh()', () => {
  const source = readLiveShellSource();
  assert.ok(
    source.includes('手动刷新'),
    'UI 中应包含"手动刷新"按钮文案',
  );
  assert.ok(
    source.includes('router.refresh()'),
    '手动刷新按钮应调用 router.refresh()',
  );
  assert.ok(
    source.includes("from 'next/navigation'"),
    '应从 next/navigation 导入 useRouter',
  );
});

test('Phase 0e | reconnectEpoch 状态应被用于强制重新挂载 SSE effect', () => {
  const source = readStreamHookSource();
  assert.ok(
    source.includes('reconnectEpoch'),
    '应声明 reconnectEpoch 状态',
  );
  // reconnectEpoch 应出现在 useEffect 依赖数组中
  const depsPattern = /\[enabled,\s*sessionId,\s*executionId,\s*reconnectEpoch\]/;
  assert.ok(
    depsPattern.test(source),
    'reconnectEpoch 应被加入 SSE useEffect 的依赖数组',
  );
});

test('Phase 0e | 连接问题横幅应在 streamConnectionIssue 存在时渲染', () => {
  const source = readLiveShellSource();
  assert.ok(
    source.includes('streamConnectionIssue ?'),
    '应在 JSX 中条件渲染 streamConnectionIssue 横幅',
  );
  // 横幅使用统一 StatusBanner warning 语义，而不是散落 amber class
  assert.ok(
    source.includes('<StatusBanner') && source.includes('tone="warning"'),
    '横幅应使用 warning 语义以传达警告状态',
  );
});
