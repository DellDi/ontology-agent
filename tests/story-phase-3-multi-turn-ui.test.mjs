import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(
  'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx',
  'utf-8',
);
const liveShellSource = readFileSync(
  'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx',
  'utf-8',
);
const pageSource = readFileSync(
  'src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx',
  'utf-8',
);

test('Chat UI | shell 渲染全轮次对话线程（无折叠摘要）', () => {
  assert.ok(shellSource.includes('turns.map'), '应按 turns 数组渲染全部轮次');
  assert.ok(shellSource.includes('data-chat-turn'), '每轮应有定位锚点');
  assert.ok(
    !shellSource.includes('CollapsedTurnSummary'),
    '不得再使用折叠轮次摘要',
  );
});

test('Chat UI | shell 提供右侧定位条与底部聊天输入框', () => {
  assert.ok(
    shellSource.includes('AnalysisChatLocator'),
    '应渲染会话定位条',
  );
  assert.ok(
    shellSource.includes('AnalysisChatComposer'),
    '应渲染聊天输入框',
  );
  assert.ok(
    shellSource.includes('sticky bottom-0'),
    '输入框应固定在对话窗口底部',
  );
});

test('Chat UI | 用户消息为气泡、AI 为智能员工身份', () => {
  const userMessage = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-user-message.tsx',
    'utf-8',
  );
  assert.ok(userMessage.includes('justify-end'), '用户消息应右对齐');
  assert.ok(userMessage.includes('rounded-2xl'), '用户消息应为气泡');
  assert.ok(
    shellSource.includes('AssistantAvatar'),
    'AI 消息应带智能员工头像',
  );
});

test('Chat UI | 发送消息自动接力执行，无手动执行入口', () => {
  const sendModule = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-send-message.ts',
    'utf-8',
  );
  assert.ok(
    sendModule.includes('createFollowUpAndExecute'),
    '应提供发送即执行编排',
  );
  assert.ok(
    sendModule.includes('/replan'),
    '上下文变更时应自动重生成计划',
  );
  assert.ok(
    !pageSource.includes('手动执行'),
    '页面不得出现手动执行入口',
  );
  assert.ok(!pageSource.includes('追问'), '页面不得出现追问字样');
});

test('Chat UI | live shell 透传轮次与抽屉内容', () => {
  assert.ok(liveShellSource.includes('turns'), 'live shell 应接受 turns');
  assert.ok(
    liveShellSource.includes('turnDrawerContents'),
    'live shell 应透传每轮抽屉内容',
  );
  assert.ok(
    liveShellSource.includes('activeTurnKey'),
    'live shell 应知道当前执行轮 key',
  );
});
