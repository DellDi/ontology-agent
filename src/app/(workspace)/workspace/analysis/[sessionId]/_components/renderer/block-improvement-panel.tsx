'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';
import { useAnalysisWorkspace } from '../analysis-workspace-context';
import { ComponentGlyph } from './prototype-component-preview';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { blockImprovementStatusLabels, blockImprovementQuery, readBlockImprovement, type BlockImprovementView } from '@/infrastructure/java-backend/block-improvement-client';



export function BlockImprovementPanel({executionId,invocationId,onOpenSidePanel,expanded=false}:{
  executionId:string;invocationId:string;onOpenSidePanel?:AnalysisInteractionUiRenderInput['onOpenSidePanel'];expanded?:boolean;
}) {
  const {sessionId}=useParams<{sessionId:string}>();
  const [open,setOpen]=useState(expanded);
  const [busy,setBusy]=useState(false);
  const queryClient=useQueryClient();
  const workspace=useAnalysisWorkspace();
  const [requestError,setError]=useState<string|null>(null);
  const base=`/api/analysis/sessions/${encodeURIComponent(sessionId)}/block-improvements`;
  const proposal=`${base}/${encodeURIComponent(executionId)}/${encodeURIComponent(invocationId)}`;
  const query=blockImprovementQuery(sessionId,executionId,invocationId);
  const initial = useQuery({...query,enabled:expanded});
  const view=initial.data;
  const error=requestError??initial.error?.message;
  const pending=busy||(expanded&&initial.isPending);
  async function request(url:string,method:'GET'|'POST'='GET') {
    setBusy(true);setError(null);
    try {queryClient.setQueryData(query.queryKey,await readBlockImprovement(url,method));setOpen(true);}
    catch(error){setError(error instanceof Error?error.message:'改造请求未完成。');}
    finally{setBusy(false);}
  }
  const canConfirm=view?.status==='prepared';
  const canCheck=view&&['unknown','context_pending','applying'].includes(view.status);
  if(!expanded&&(onOpenSidePanel||workspace)) return <section className="mt-4 flex flex-wrap items-center justify-between gap-3 py-3" aria-label="应用块内改造">
    <p className="text-sm font-medium">修改建议</p>
    <Button type="button" size="sm" variant="outline" onClick={()=>workspace?workspace.openProposal({executionId,invocationId}):onOpenSidePanel?.({title:'区域改进 · 预览与确认',testId:'analysis-improvement-context',
      content:<BlockImprovementPanel key={`${executionId}:${invocationId}`} executionId={executionId} invocationId={invocationId} expanded />})}>查看改进建议</Button>
  </section>;
  return <section className="mt-5 space-y-4 py-2" aria-label="应用块内改造">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {!expanded ? <Button size="sm" variant="ghost" disabled={pending} onClick={()=>open?setOpen(false):void request(proposal)} aria-expanded={open}>{pending?'正在读取…':open?'收起':'查看与应用'}</Button> : null}</div>
    {expanded&&initial.isPending?<p role="status" className="text-sm text-muted-foreground">正在读取当前提案…</p>:null}
    {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
    {open&&view?<div className="space-y-4">
      <div className="flex items-start justify-between gap-3 text-sm"><span className="text-muted-foreground">{view.applicationName}</span><span className="shrink-0 font-medium" role="status">{blockImprovementStatusLabels[view.status]}</span></div>
      {!view.executionAvailable ? <p className="text-sm text-muted-foreground">当前环境未启用源写回，建议仅供查看。</p> : null}
      {view.proposal.textChange ? <dl className="space-y-4 py-2 text-sm" aria-label="文案修改前后">
        {view.proposal.textChange.beforeTitle !== view.proposal.textChange.afterTitle ? <div><dt className="font-medium">模块标题</dt><dd>{view.proposal.textChange.beforeTitle} → {view.proposal.textChange.afterTitle}</dd></div> : null}
        {view.proposal.textChange.beforePurpose !== view.proposal.textChange.afterPurpose ? <div><dt className="font-medium">模块用途</dt><dd>{view.proposal.textChange.beforePurpose} → {view.proposal.textChange.afterPurpose}</dd></div> : null}
      </dl> : null}
      {view.proposal.changes.length ? <h3 className="text-sm font-semibold">建议改动</h3> : null}<ul className="space-y-3 text-sm">{view.proposal.changes.map(change=><li key={change.componentId}><span className="font-medium">{change.name}</span>：{view.chartLabels[change.beforeChart]??'当前图形'} → {view.chartLabels[change.afterChart]??'建议图形'}<p className="text-xs leading-5 text-muted-foreground">{change.reason}</p></li>)}</ul>
      {view.preparedBlock?<PreparedBlock block={view.preparedBlock} chartLabels={view.chartLabels}/>:null}
      <div className="space-y-2 text-sm leading-6"><p className="line-clamp-3">{view.proposal.diagnosis.themeFit}</p>
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">分析依据</summary><div className="mt-3 space-y-3 leading-6"><p>{view.proposal.diagnosis.themeFit}</p><p>{view.proposal.diagnosis.metricChartFit}</p><p>{view.proposal.diagnosis.composition}</p>
          {view.proposal.pendingChecks.length ? <ul className="space-y-2">{view.proposal.pendingChecks.map((item,i) => <li key={i}>{item}</li>)}</ul> : null}
        </div></details>
      </div>
      {view.executionAvailable ? <p className="text-xs leading-5 text-muted-foreground">{view.preparedBlock ? '预览来自 EasyV 当前原型，确认后保存。' : '准备预览会读取 EasyV 当前原型，不会直接保存。'}</p> : null}
      {view.error?<p role="alert" className="text-sm text-destructive">{view.error}</p>:null}
      {view.executionAvailable&&(view.status==='proposal'||view.status==='conflict'||view.status==='failed')?<Button disabled={busy} onClick={()=>void request(`${proposal}/prepare`,'POST')}>{busy?'正在准备…':'查看修改预览'}</Button>:null}
      {view.executionAvailable&&canConfirm?<div className="space-y-2"><p className="text-sm">确认将上面的准备结果保存到 EasyV？</p><Button disabled={busy} onClick={()=>void request(`${base}/actions/${encodeURIComponent(view.actionId ?? '')}/confirm`,'POST')}>{busy?'正在保存…':'确认并保存到 EasyV'}</Button></div>:null}
      {view.executionAvailable&&canCheck?<Button variant="ghost" disabled={busy} onClick={()=>void request(`${base}/actions/${encodeURIComponent(view.actionId ?? '')}/confirm`,'POST')}>{busy?'正在核查…':'核查并恢复同一方案'}</Button>:null}
      {view.status==='verified'?<p className="text-sm text-success-500">该动作已完成保存读回核对。画布仍显示平台已发布结构；实际源画面请在 EasyV 核对，工作台结构与统计会在下一次采集后更新。</p>:null}
    </div>:null}
  </section>;
}

function PreparedBlock({block,chartLabels}:{block:NonNullable<BlockImprovementView['preparedBlock']>;chartLabels:Record<string,string>}) {
  const components=Array.isArray(block.components)?block.components:[];
  return <div><p className="mb-2 text-xs font-medium">修改后结构示意 · 非真实业务数值</p><div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted/40" aria-label="改造原型块示意">
    {components.map((raw,index)=>{
      if(!raw||typeof raw!=='object')return null;
      const component=raw as Record<string,unknown>;
      const config=component.config&&typeof component.config==='object'?component.config as Record<string,unknown>:{};
      const percent=(value:unknown)=>typeof value==='string'&&/^\d+(\.\d+)?%$/.test(value)?value:undefined;
      return <div key={index} className="absolute flex flex-col items-center justify-center overflow-hidden bg-primary/5 p-2 text-center" style={{left:percent(config.relativeX),top:percent(config.relativeY),width:percent(config.width),height:percent(config.height)}}>
        <ComponentGlyph family={String(component.chartFamily)} className="min-h-0 flex-1 text-primary" /><p className="line-clamp-2 text-sm font-medium">{String(component.metricName??component.name??'指标')}</p><p className="mt-1 text-xs text-muted-foreground">{chartLabels[String(component.chartFamily)]??'图形'}</p>
      </div>;
    })}
  </div></div>;
}
