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

test('Chat UI | 内网 HTTP 缺少 randomUUID 时仍能启动已创建的追问', () => {
  const { key, target } = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import { webcrypto } from 'node:crypto';
    import send from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-send-message.ts';
    globalThis.window = { location: { origin: 'http://192.0.2.1:3100' } };
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } });
    let key;
    globalThis.fetch = async (path, init) => {
      if (path.endsWith('/follow-ups/follow-up')) return { ok: true, json: async () => ({}) };
      if (!path.endsWith('/execute') || init.body.get('followUpId') !== 'follow-up') throw Error('unexpected request');
      key = init.headers['Idempotency-Key'];
      return { ok: true, url: window.location.origin + '/workspace/analysis/session?executionId=execution' };
    };
    const target = await send.executePendingFollowUp('session', 'follow-up');
    console.log(JSON.stringify({ key, target }));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(target, '/workspace/analysis/session?executionId=execution');
});

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
      emptyTimeline: render({ status: 'completed', toolTimeline: [{ stepId: 'plan', stepName: '规划完成', status: 'completed', subSteps: [] }] }),
      emptyQuery: render({ status: 'completed', toolTimeline: [{ stepId: 'query', stepName: '查询', status: 'completed', subSteps: [
        { toolName: 'cube.query', objective: '数据查询', status: 'completed', output: { rows: 0 } },
      ] }] }),
      failedAfterRead: render({ status: 'failed', toolTimeline: [{ stepId: 'plan', stepName: '规划失败', status: 'failed', subSteps: [
        { toolName: 'read', toolLabel: '读取对象', objective: '读取对象', status: 'completed' },
      ] }] }),
      tool: render({ status: 'running', toolActivities: [{ toolName: 'semantic-query', objective: '查询', status: 'running' }] }),
      completed: render({ status: 'completed', primaryAnswer: '共有 119 个原型' }),
      failed: render({ status: 'failed', errorSummary: '数据查询失败：权限不足' }),
      unsupported: render({ status: 'failed', errorCode: 'EASYV_QUESTION_UNSUPPORTED', errorSummary: '当前入口不支持跨块搬移' }),
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
  assert.doesNotMatch(html.streaming, /正在生成真实回答/);
  assert.match(html.streaming, /核对来源/);
  assert.match(html.timeline, /查看分析过程/);
  assert.match(html.timeline, /aria-expanded="false"/);
  assert.doesNotMatch(html.timeline, /查询授权数据/);
  assert.doesNotMatch(html.emptyTimeline, /查看分析过程/, '只有完成节点时不展示空过程');
  assert.match(html.emptyQuery, /查看分析过程/, '查询返回零条也是真实结果，不能隐藏');
  assert.match(html.failedAfterRead, /查看分析过程/, '子工具完成不能遮掉后续步骤失败');
  assert.match(html.tool, /执行中/);
  assert.match(html.completed, /共有 119 个原型/);
  assert.match(html.failed, /数据查询失败：权限不足/);
  assert.match(html.unsupported, /当前入口暂不支持这个操作/);
  assert.doesNotMatch(html.unsupported, /分析过程中遇到问题|bg-rose-50|role="alert"/);
  assert.match(html.disconnected, /实时连接中断/);
});

test('Chat UI | 未发布模型或数据时保留问题、停止等待并按权限提供管理入口', () => {
  const html = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import context from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
    import {createRequire} from 'node:module';
    const {QueryClient,QueryClientProvider}=createRequire(import.meta.url)('@tanstack/react-query');
    import shell from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx';
    const props = {
      sessionId: 'session-empty', viewModel: null,
      turns: [{ key: 'initial', kind: 'initial', questionText: '统计 AI 大屏数量', status: 'pending', live: false }],
      turnDrawerContents: {},
    };
    const render = (submissionError) => renderToStaticMarkup(React.createElement(
      context.AppRouterContext.Provider, { value: {} },
      React.createElement(QueryClientProvider,{client:new QueryClient()},React.createElement(shell.AnalysisConversationShell, { ...props, submissionError })),
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
  assert.ok(userMessage.includes('<MessageContent'), '用户消息沿用 AI Elements 消息容器，不依赖特定圆角尺寸');
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

test('Chat UI | 大屏画布先于正文，只挂载当前画布，提案图表保留上下文入口', () => {
  const html = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import message from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-assistant-message.tsx';
    import renderers from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-ui-renderer-registry.tsx';
    const registry = renderers.getDefaultAnalysisInteractionUiRendererRegistry();
    registry.register({ kind: 'object-browser', render: ({renderedBlock}) => React.createElement('div', {'data-canvas': renderedBlock.title}, renderedBlock.title) });
    registry.register({ kind: 'table', render: ({onOpenSidePanel}) => React.createElement('span', {}, onOpenSidePanel ? '可以打开提案上下文' : '入口丢失') });
    const object = (title, objectKey) => ({ kind: 'object-browser', title, payload: {objectKey}, source: {} });
    const props = {
      headline: '分析完成', status: 'completed', toolActivities: [], toolTimeline: [], primaryAnswer: '本轮业务结论',
      metricCards: [], visualizations: [{type:'table',title:'改造提案',data:{columns:[],rows:[]}}],
      result: { blocks: [object('水利原型', 'easyv-prototype-layout'), object('交通原型', 'easyv-prototype-layout'), object('需求记录', 'easyv-quality-node')], evidenceBlocks: [], reasoningBlocks: [], assumptionBlocks: [] },
      diagnostics: { timelineBlocks: [], processBoardBlocks: [], renderErrors: [], otherBlocks: [] },
      onOpenDetail: () => {}, onOpenSidePanel: () => {},
    };
    console.log(JSON.stringify(renderToStaticMarkup(React.createElement(message.AnalysisAssistantMessage, props))));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));
  assert.match(html, /aria-label="大屏结构工作区"/);
  assert.match(html, /aria-label="选择当前画布"/);
  assert.equal((html.match(/data-canvas=/g) ?? []).length, 1, '未选中的原型不挂载，避免同时读取全部原型');
  assert.ok(html.indexOf('data-canvas=') < html.indexOf('本轮业务结论'));
  assert.match(html, /需求记录/);
  assert.match(html, /可以打开提案上下文/);
  assert.doesNotMatch(html, /入口丢失/);
});

test('Chat UI | 当前画布独立于历史消息，查看对话不会重复挂载画布',()=>{
  const rendered=JSON.parse(execFileSync('node',['--import','tsx','--input-type=module','-e',`
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {createRequire} from 'node:module';
    const {QueryClient,QueryClientProvider}=createRequire(import.meta.url)('@tanstack/react-query');
    import context from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
    import shell from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx';
    import renderers from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-ui-renderer-registry.tsx';
    renderers.getDefaultAnalysisInteractionUiRendererRegistry().register({kind:'object-browser',render:()=>React.createElement('div',{'data-central-canvas':true},'当前画布')});
    const block={kind:'object-browser',title:'水利原型',payload:{objectKey:'easyv-prototype-layout',filters:[]},source:{sessionId:'session',executionId:'execution'}};
    const assistantMessage={status:'completed',headline:'分析完成',toolActivities:[],toolTimeline:[],primaryAnswer:'当时的分析结论',metricCards:[],visualizations:[],
      diagnostics:{timelineBlocks:[],processBoardBlocks:[],renderErrors:[],otherBlocks:[]},
      result:{blocks:[block],evidenceBlocks:[],reasoningBlocks:[],assumptionBlocks:[]}};
    const props={sessionId:'session',viewModel:{assistantMessage},turns:[{key:'initial',kind:'initial',live:true,status:'completed',questionText:'检查水利大屏'}],turnDrawerContents:{}};
    const render=(input)=>renderToStaticMarkup(React.createElement(QueryClientProvider,{client:new QueryClient()},
      React.createElement(context.AppRouterContext.Provider,{value:{}},React.createElement(shell.AnalysisConversationShell,input))));
    const understanding={id:'q',label:'原型数量',object:{key:'easyv-prototype-layout',label:'原型'},measures:[{key:'count',label:'数量'}],dimensions:[],filters:[],
      time:{dimension:'createdAt',label:'创建时间',sourceText:'全部数据',kind:'all',from:null,to:'2026-10-26',allData:true,granularity:null},compare:null,limit:null,
      coverage:{status:'full',dataFrom:null,dataTo:null,effectiveFrom:null,effectiveTo:null}};
    console.log(JSON.stringify({canvas:render(props),statistics:render({...props,turns:[{...props.turns[0],understanding:[understanding]}]})}));
  `],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}}));
  const html=rendered.canvas;
  assert.doesNotMatch(rendered.statistics,/data-central-canvas=|大屏工作区/);
  assert.match(rendered.statistics,/当时的分析结论/);
  assert.match(html,/<h1[^>]*>大屏工作区<\/h1>/);
  assert.equal((html.match(/data-central-canvas=/g)??[]).length,1);
  assert.ok(html.indexOf('data-central-canvas=')<html.indexOf('data-chat-turn='));
  assert.match(html,/历史分析/);
  assert.match(html,/当前应用状态见右侧修改建议/);
  assert.match(html,/对话记录/);
});

test('Chat UI | 批次复核按大屏 ID 归拢，历史和读不到的建议保留各自状态',()=>{
  const html=execFileSync('node',['--import','tsx','--input-type=module','-e',`
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {readFileSync} from 'node:fs';
    import review from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-proposal-review.tsx';
    const fixture=JSON.parse(readFileSync('contracts/backend/fixtures/block-improvement-action.json','utf8'));
    const item=(executionId,invocationId,view)=>({reference:{executionId,invocationId},view:{...fixture,...view}});
    const props={
      current:[
        item('batch','1',{applicationId:'a',title:'营收',status:'verified'}),
        item('batch','2',{applicationId:'b',title:'回款',status:'prepared'}),
        item('batch','3',{applicationId:'a',title:'利润',status:'conflict'}),
      ],
      earlier:[item('prior','4',{applicationId:'a',title:'旧建议',status:'verified'})],
      unread:[{reference:{executionId:'batch',invocationId:'5'},error:'当前账号不能读取建议'}],
      turnNumbers:new Map([['batch',2],['prior',1]]),onOpen:()=>{},
    };
    console.log(renderToStaticMarkup(React.createElement(review.AnalysisProposalReview,props)));
  `],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});
  assert.match(html,/已核对 1 \/ 3 条/);
  assert.match(html,/1 条需处理异常/);
  assert.equal((html.match(/<section /g)??[]).length,2,'同名大屏中的不同应用不合并');
  assert.ok(html.indexOf('营收')<html.indexOf('利润')&&html.indexOf('利润')<html.indexOf('回款'),'同一大屏的建议相邻');
  assert.match(html,/待确认/);
  assert.match(html,/原型已变化/);
  assert.match(html,/历史建议 · 1[\s\S]*旧建议/);
  assert.match(html,/role="alert">当前账号不能读取建议/);
});

test('Chat UI | 写回侧栏按准备、待核查和已核对状态展示文案与操作',()=>{
  const html=JSON.parse(execFileSync('node',['--import','tsx','--input-type=module','-e',`
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {readFileSync,} from 'node:fs';
    import {createRequire} from 'node:module';
    const {QueryClient,QueryClientProvider}=createRequire(import.meta.url)('@tanstack/react-query');
    import navigation from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
    import panel from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/block-improvement-panel.tsx';
    const fixture=JSON.parse(readFileSync('contracts/backend/fixtures/block-improvement-action.json','utf8'));
    const textChange={beforeTitle:'地市业绩',afterTitle:'建议标题',beforePurpose:'多维业绩对比',afterPurpose:'建议用途'};
    const render=(status,executionAvailable,savedText={})=>{
      const client=new QueryClient({defaultOptions:{queries:{gcTime:Infinity}}});
      client.setQueryData(['block-improvement','session','execution','proposal'],{...fixture,status,executionAvailable,
        proposal:{...fixture.proposal,textChange},preparedBlock:{...fixture.preparedBlock,...savedText}});
      return renderToStaticMarkup(React.createElement(QueryClientProvider,{client},React.createElement(navigation.PathParamsContext.Provider,{value:{sessionId:'session'}},
        React.createElement(panel.BlockImprovementPanel,{executionId:'execution',invocationId:'proposal',expanded:true}))));
    };
    const savedText={businessModule:'各地市存款余额排行',moduleDescription:'比较浙江各地市存款余额'};
    console.log(JSON.stringify({disabled:render('prepared',false),enabled:render('prepared',true),
      pending:render('context_pending',true,savedText),verified:render('verified',true,savedText),
      archived:render('verified',false,savedText),legacy:render('verified',true)}));
  `],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}}));
  assert.match(html.disabled,/当前环境未启用源写回/);
  assert.doesNotMatch(html.disabled,/确认并保存到 EasyV/);
  assert.match(html.enabled,/确认并保存到 EasyV/);
  assert.match(html.enabled,/建议标题/);
  assert.match(html.pending,/核查并恢复同一方案/);
  assert.doesNotMatch(html.pending,/已核对的源端文案|确认后保存/);
  assert.match(html.verified,/已核对的源端文案/);
  assert.match(html.verified,/地市业绩 → 各地市存款余额排行/);
  assert.match(html.verified,/多维业绩对比 → 比较浙江各地市存款余额/);
  assert.match(html.verified,/保存读回时的结构示意/);
  assert.doesNotMatch(html.verified,/建议标题|建议用途|确认后保存|确认并保存到 EasyV/);
  assert.match(html.archived,/已核对的源端文案/);
  assert.doesNotMatch(html.archived,/建议仅供查看/);
  assert.doesNotMatch(html.legacy,/已核对的源端文案|建议标题|确认后保存/);
});
