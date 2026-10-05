import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

test('Chat UI | 等待首个进度显示反馈，真实步骤、回答和错误保持可见', () => {
  // Client components need the regular React runtime, not the parent gate's react-server condition.
  const html = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import messageModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-assistant-message.tsx';
    const props = {
      headline: '执行中', toolActivities: [], toolTimeline: [], primaryAnswer: '',
      metricCards: [], visualizations: [], result: null,
      diagnostics: { timelineBlocks: [], processBoardBlocks: [], renderErrors: [], otherBlocks: [] },
      onOpenDetail: () => {},
    };
    const render = (extra) => renderToStaticMarkup(React.createElement(messageModule.AnalysisAssistantMessage, { ...props, ...extra }));
    console.log(JSON.stringify({
      queued: render({ status: 'queued' }),
      running: render({ status: 'running' }),
      streaming: render({ status: 'running', streamingAnswer: '正在生成真实回答' }),
      timeline: render({ status: 'running', toolTimeline: [{ stepId: 'query', stepName: '查询授权数据', status: 'running', subSteps: [] }] }),
      tool: render({ status: 'running', toolActivities: [{ toolName: 'semantic-query', objective: '查询', status: 'running' }] }),
      completed: render({ status: 'completed', primaryAnswer: '共有 119 个原型' }),
      failed: render({ status: 'failed', errorSummary: '数据查询失败：权限不足' }),
      disconnected: render({ status: 'disconnected', headline: '实时连接中断' }),
    }));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));

  for (const status of ['queued', 'running']) {
    assert.match(html[status], /role="status"/);
    assert.match(html[status], /aria-live="polite"/);
    assert.doesNotMatch(html[status], /rounded-tl-md border border-border bg-card/,
      '没有进度或回答时不得渲染空的全宽回答气泡');
  }
  assert.match(html.queued, /问题已提交，等待分析进度/);
  assert.match(html.running, /正在处理，结果会逐步显示/);
  for (const status of ['streaming', 'timeline', 'tool', 'completed', 'failed', 'disconnected']) {
    assert.doesNotMatch(html[status], /等待分析进度|结果会逐步显示/);
  }
  assert.match(html.streaming, /正在生成真实回答/);
  assert.match(html.timeline, /查询授权数据/);
  assert.match(html.tool, /执行中/);
  assert.match(html.completed, /共有 119 个原型/);
  assert.match(html.failed, /数据查询失败：权限不足/);
  assert.match(html.disconnected, /实时连接中断/);
});

test('Chat UI | 未发布模型或数据时保留问题、停止等待并按权限提供管理入口', () => {
  const html = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import context from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
    import shell from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx';
    const props = {
      sessionId: 'session-empty', viewModel: null,
      turns: [{ key: 'initial', kind: 'initial', questionText: '统计 AI 大屏数量', status: 'pending', live: false }],
      turnDrawerContents: {},
    };
    const render = (submissionError) => renderToStaticMarkup(React.createElement(
      context.AppRouterContext.Provider, { value: {} },
      React.createElement(shell.AnalysisConversationShell, { ...props, submissionError }),
    ));
    console.log(JSON.stringify({
      model: render({ message: '本体未发布', code: 'ONTOLOGY_NOT_PUBLISHED', traceId: 'trace-model', setupHref: '/admin/ontology' }),
      data: render({ message: '数据未发布', code: 'DATASET_VERSION_SET_NOT_PUBLISHED', traceId: 'trace-data', setupHref: '/admin/ingestion' }),
      analyst: render({ message: '数据未发布', code: 'DATASET_VERSION_SET_NOT_PUBLISHED' }),
    }));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));
  for (const content of Object.values(html)) {
    assert.match(content, /统计 AI 大屏数量/);
    assert.match(content, /分析暂未就绪/);
    assert.match(content, /当前未启动分析/);
    assert.match(content, /role="alert"/);
    assert.doesNotMatch(content, /等待分析进度|正在思考|正在处理/);
    assert.doesNotMatch(content, /<textarea[^>]*\sdisabled(?:=|\s|>)/);
  }
  assert.match(html.model, /href="\/admin\/ontology"/);
  assert.match(html.model, /trace-model/);
  assert.match(html.data, /href="\/admin\/ingestion"/);
  assert.match(html.analyst, /请联系管理员/);
  assert.doesNotMatch(html.analyst, /href="\/admin\//);
});

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
    shellSource.includes('<Conversation') &&
      shellSource.includes('ConversationScrollButton'),
    '消息流应使用 AI Elements Conversation 内嵌滚动并提供回到底部按钮',
  );
  assert.ok(
    !shellSource.includes('sticky bottom-0'),
    '输入框不再依赖文档级 sticky 定位，由 Conversation 内嵌滚动布局承接',
  );
});

test('Chat UI | 用户消息为气泡、AI 为智能员工身份', () => {
  const userMessage = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-user-message.tsx',
    'utf-8',
  );
  assert.ok(
    userMessage.includes('from="user"'),
    '用户消息应通过 AI Elements Message 右对齐（is-user）',
  );
  assert.ok(userMessage.includes('rounded-2xl'), '用户消息应为气泡');
  const thinkingMessage = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-thinking-message.tsx',
    'utf-8',
  );
  assert.ok(
    shellSource.includes('<AnalysisThinkingMessage') && thinkingMessage.includes('<AssistantAvatar'),
    '等待与发送占位共用带智能员工头像的消息组件',
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
