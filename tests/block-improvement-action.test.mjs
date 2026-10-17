import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import actionClient from '../src/infrastructure/java-backend/block-improvement-client.ts';
import prepareRoute from '../src/app/api/analysis/sessions/[sessionId]/block-improvements/[executionId]/[invocationId]/prepare/route.ts';
import confirmRoute from '../src/app/api/analysis/sessions/[sessionId]/block-improvements/actions/[actionId]/confirm/route.ts';
import streamModels from '../src/domain/analysis-execution/stream-models.ts';
import interactionParts from '../src/application/analysis-interaction/interaction-part-schema.ts';
const fixture=JSON.parse(await readFile(new URL('../contracts/backend/fixtures/block-improvement-action.json',import.meta.url),'utf8'));
const {blockImprovementViewSchema,readBlockImprovement}=actionClient;

test('块内改造 | 执行流到工作台投影保留正式提案入口，拒绝不完整引用',()=>{
  const reference={executionId:'execution',invocationId:'proposal'};
  const event={id:'event',sessionId:'session',executionId:'execution',sequence:1,kind:'stage-result',timestamp:'2026-10-17T12:00:00Z',renderBlocks:[{type:'table',title:'改造建议',columns:['指标'],rows:[['资源占用']],blockImprovement:reference}]};
  const normalized=streamModels.validateAnalysisExecutionStreamEvent(event);
  const part=interactionParts.normalizeExecutionRenderBlock(normalized.renderBlocks[0],{sourceType:'execution-render-block',executionId:'execution'});
  for(const surface of ['workspace','mobile']){
    assert.deepEqual(interactionParts.projectAnalysisInteractionPart(part,{surface}).payload.blockImprovement,reference);
  }
  for(const invalid of [{executionId:'execution'},{executionId:'execution',invocationId:''},{...reference,extra:'untrusted'}]){
    assert.throws(()=>streamModels.validateAnalysisExecutionStreamEvent({...event,renderBlocks:[{...event.renderBlocks[0],blockImprovement:invalid}]}));
  }
  const ordinary={...event.renderBlocks[0]};delete ordinary.blockImprovement;
  assert.equal(streamModels.validateAnalysisExecutionStreamEvent({...event,renderBlocks:[ordinary]}).renderBlocks[0].blockImprovement,undefined);
});

test('块内改造 | 明确区分提案、待确认、处理中、部分完成、未知和已核对',()=>{
  for(const status of ['proposal','prepared','applying','verified','context_pending','unknown','conflict','failed'])
    assert.equal(blockImprovementViewSchema.safeParse({...fixture,status}).success,true);
  assert.equal(blockImprovementViewSchema.safeParse({...fixture,status:'applied'}).success,false);
  for(const config of [{relativeX:'0%',relativeY:'0%',width:'invalid',height:'100%'},{relativeX:'-50%',relativeY:'0%',width:'100%',height:'100%'}]){
    const broken=structuredClone(fixture);broken.preparedBlock.components[0].config=config;
    assert.equal(blockImprovementViewSchema.safeParse(broken).success,false);
  }
});

test('块内改造 | 确认无需重交提案,BFF 仅透传动作路径和登录会话',async(t)=>{
  const previous=process.env.JAVA_BACKEND_URL;const requests=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({url:req.url,cookie:req.headers.cookie,body});
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(fixture));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;process.env.JAVA_BACKEND_URL=base;
  t.after(()=>{if(previous===undefined)delete process.env.JAVA_BACKEND_URL;else process.env.JAVA_BACKEND_URL=previous;server.close();});
  for(const [route,path] of [[prepareRoute,'execution/proposal/prepare'],[confirmRoute,'actions/action/confirm']]){
    const response=await route.POST(new Request(`http://web.local/api/analysis/sessions/session/block-improvements/${path}`,{method:'POST',headers:{cookie:'dip3_session=local-test'}}));
    assert.equal(response.status,200);assert.deepEqual(await response.json(),fixture);
  }
  assert.equal(requests.length,2);assert.equal(requests[1].cookie,'dip3_session=local-test');assert.equal(requests[1].body,'');
  assert.equal(requests[1].url,'/api/analysis/sessions/session/block-improvements/actions/action/confirm');
  assert.equal((await readBlockImprovement(base+'/read')).status,'prepared');
});
