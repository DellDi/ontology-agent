import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import client from '../src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-send-message.ts';
import turnsModule from '../src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-chat-turns.ts';
import contract from '../src/infrastructure/java-backend/object-read-contract.ts';
import staticModule from '../src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-static-assistant-props.ts';
import readClient from '../src/infrastructure/java-backend/read-client.ts';

const selection = { executionId: 'execution-source', datasetVersionSetId: 'set-old', reference: {
  objectKey: 'easyv-prototype-block', objectId: 'a:left', productVersionId: 'blocks-old',
} };

test('对象追问 | 真实引用提交、明确取消、结构化调整与拒绝原因', async (context) => {
  const oldFetch = globalThis.fetch; const oldWindow = globalThis.window; const calls = [];
  globalThis.window = { location: { origin: 'http://localhost:3000' } };
  let reject = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null });
    if (reject) return new Response(JSON.stringify({ error: '所选对象版本与冻结集合不一致。', code: 'OBJECT_VERSION_MISMATCH', traceId: 'trace-test' }), {status:409});
    const detail = /follow-ups\/follow-test$/.test(url);
    return { ok: true, url: detail ? `http://localhost:3000${url}`
      : url.endsWith('/execute') ? 'http://localhost:3000/workspace/analysis/session?executionId=execution-new&followUpId=follow-test'
      : 'http://localhost:3000/workspace/analysis/session?followUpId=follow-test',
      json: async () => ({ inheritedContext:{}, mergedContext:{}, currentPlanSnapshot:null }) };
  };
  context.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  await client.createFollowUpAndExecute('session', '为什么这个区域重复？', selection);
  assert.deepEqual(JSON.parse(calls[0].body.objectSelection), selection);
  assert.equal(calls[0].body.parentFollowUpId, undefined, 'parent comes from owned source execution');
  assert.equal(calls[2].body.followUpId, 'follow-test');
  calls.length = 0;
  await client.createFollowUpAndExecute('session', '看全部');
  assert.equal(calls[0].body.objectSelection, 'null');
  calls.length = 0;
  await client.createStructuredFollowUpAndExecute('session', {question:'按月', queries:[], objectSelection: selection});
  assert.deepEqual(JSON.parse(calls[0].body.objectSelection), selection);
  reject = true;
  await assert.rejects(client.createFollowUpAndExecute('session', '继续', selection), /版本.*trace-test/);
  calls.length = 0;
  await assert.rejects(client.createFollowUpAndExecute('session', '继续', {...selection, properties:{appId:'forged'}}));
  assert.equal(calls.length, 0, 'untrusted client properties are rejected before fetch');
});

test('对象追问 | 历史恢复沿已完成轮次续接、来源版本保留', () => {
  const round = {id:'r2', kind:'follow-up', questionText:'继续', executionId:'execution-result', followUpId:'f2', status:'completed',
    conclusionState:null, planSnapshot: {_objectSelection:selection, _objectSelectionLabel:'原型区域 · left'} };
  const [turn] = turnsModule.buildChatTurns({history:[round], followUps:[]}, 'execution-result');
  assert.equal(turn.objectSelection.executionId, 'execution-result');
  assert.equal(turn.objectSelection.datasetVersionSetId, selection.datasetVersionSetId);
  assert.deepEqual(turn.objectSelection.reference, selection.reference);
  assert.equal(turn.objectSelectionLabel, '原型区域 · left');
  const [pending] = turnsModule.buildChatTurns({history:[{...round,status:'processing'}], followUps:[]}, 'execution-result');
  assert.equal(pending.objectSelection.executionId, 'execution-source');
  const [ordinary] = turnsModule.buildChatTurns({history:[{...round,planSnapshot:null}],followUps:[]}, 'execution-result');
  assert.equal(ordinary.objectSelection, undefined);
});

test('对象追问 | 快照拒绝伪造来源绑定与无引用标签', async () => {
  assert.equal(contract.javaObjectSelectionSchema.safeParse(selection).success, true);
  const fixture = JSON.parse(await readFile(new URL('../contracts/backend/fixtures/snapshot-semantic-query.json',import.meta.url),'utf8'));
  fixture.ontologyVersionBindingSource = fixture.ontologyVersionBinding.source;
  delete fixture.ownerUserId; delete fixture.ontologyVersionBinding; delete fixture.datasetVersionSetId;
  fixture.followUpId = 'follow-test';
  Object.assign(fixture.planSnapshot, {_executionContract:'java-follow-up-v1', _followUpId:'follow-test', _referencedExecutionId:selection.executionId,
    _objectSelection:selection, _objectSelectionLabel:'原型区域 · left'});
  assert.equal(readClient.javaExecutionSnapshotSchema.safeParse(fixture).success, true);
  fixture.planSnapshot._referencedExecutionId='another-execution';
  assert.equal(readClient.javaExecutionSnapshotSchema.safeParse(fixture).success, false);
  delete fixture.planSnapshot._objectSelection;
  assert.equal(readClient.javaExecutionSnapshotSchema.safeParse(fixture).success, false);
});


test('对象追问 | 历史助手实际组件入口携带该轮执行，不能借用当前轮', () => {
  const block = {type:'object-browser',title:'对象范围',role:'supporting',objectKey:'easyv-prototype-layout',
    datasetVersionSetId:'set-old', filters:[],scopeDescription:'原轮次对象范围'};
  const props = staticModule.buildStaticAssistantProps({key:'r-old',executionId:'execution-old',status:'completed',
    conclusionState:{causes:[],renderBlocks:[block]}}, 'session-old');
  const browser = props.result.blocks.find(block => block.kind === 'object-browser');
  assert.equal(browser.source.executionId, 'execution-old');
  assert.equal(browser.source.sessionId, 'session-old');
  assert.equal(browser.payload.datasetVersionSetId, 'set-old');
});


test('对象追问 | AI 应用对象范围的历史入口携带该轮执行', () => {
  const block = {type:'object-browser',title:'AI 应用数 · 对象范围',role:'supporting',objectKey:'easyv-ai-application',
    datasetVersionSetId:'set-old', filters:[],scopeDescription:'本次查询当前期的对象范围'};
  const props = staticModule.buildStaticAssistantProps({key:'r-old',executionId:'execution-old',status:'completed',
    conclusionState:{causes:[],renderBlocks:[block]}}, 'session-old');
  const browser = props.result.blocks.find(block => block.kind === 'object-browser');
  assert.equal(browser.payload.objectKey, 'easyv-ai-application');
  assert.equal(browser.source.executionId, 'execution-old');
  assert.equal(browser.source.sessionId, 'session-old');
});


test('对象追问 | 待执行和失败历史保留请求引用，取消后的普通轮不恢复旧选择', () => {
  const initial={id:'root',kind:'initial',status:'completed',executionId:'execution-source',followUpId:null,planSnapshot:null};
  const selected={id:'f-selected',questionText:'针对这个',resultExecutionId:null,mergedContext:{objectSelection:selection}};
  const pending=turnsModule.buildChatTurns({history:[initial],followUps:[selected]},null).at(-1);
  assert.deepEqual(pending.objectSelection,selection);
  const failed={...initial,id:'failed',kind:'follow-up',status:'failed',followUpId:selected.id,executionId:'execution-failed',planSnapshot:null};
  const failedTurn=turnsModule.buildChatTurns({history:[initial,failed],followUps:[{...selected,resultExecutionId:'execution-failed'}]},null).at(-1);
  assert.deepEqual(failedTurn.objectSelection,selection,'a failed execution cannot become the selected source');
  const ordinary=turnsModule.buildChatTurns({history:[initial,failed,{...failed,id:'ordinary',followUpId:'f-ordinary'}],followUps:[selected,
    {id:'f-ordinary',questionText:'全部',resultExecutionId:'ordinary',mergedContext:{}}]},null).at(-1);
  assert.equal(ordinary.objectSelection,undefined);
});
