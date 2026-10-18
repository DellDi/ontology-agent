'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { readBlockImprovement, type BlockImprovementView } from '@/infrastructure/java-backend/block-improvement-client';

const labels:Record<BlockImprovementView['status'],string>={proposal:'尚未应用',prepared:'待确认',applying:'正在保存',verified:'已保存并核对',context_pending:'原型已保存,编辑上下文待恢复',unknown:'保存结果待核查',conflict:'原型已变化,请重新核对',failed:'本次未能执行'};

export function BlockImprovementPanel({executionId,invocationId}:{executionId:string;invocationId:string}) {
  const {sessionId}=useParams<{sessionId:string}>();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [view,setView]=useState<BlockImprovementView|null>(null);
  const [error,setError]=useState<string|null>(null);
  const base=`/api/analysis/sessions/${encodeURIComponent(sessionId)}/block-improvements`;
  const proposal=`${base}/${encodeURIComponent(executionId)}/${encodeURIComponent(invocationId)}`;
  async function request(url:string,method:'GET'|'POST'='GET') {
    setBusy(true);setError(null);
    try {setView(await readBlockImprovement(url,method));setOpen(true);}
    catch(error){setError(error instanceof Error?error.message:'改造请求未完成。');}
    finally{setBusy(false);}
  }
  const canConfirm=view?.status==='prepared';
  const canCheck=view&&['unknown','context_pending','applying'].includes(view.status);
  return <section className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 p-4" aria-label="应用块内改造">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">把建议应用到 EasyV 原型</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>open?setOpen(false):void request(proposal)} aria-expanded={open}>{busy?'正在读取…':open?'收起':'查看与应用'}</Button></div>
    {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
    {open&&view?<div className="space-y-4">
      <p className="text-sm" role="status">{view.applicationName} / {view.title} · {labels[view.status]}</p>
      <div className="space-y-2 text-sm leading-6"><p>{view.proposal.diagnosis.themeFit}</p><p>{view.proposal.diagnosis.metricChartFit}</p><p>{view.proposal.diagnosis.composition}</p></div>
      {view.proposal.textChange ? <dl className="space-y-2 rounded-lg border p-3 text-sm" aria-label="文案修改前后">
        {view.proposal.textChange.beforeTitle !== view.proposal.textChange.afterTitle ? <div><dt className="font-medium">模块标题</dt><dd>{view.proposal.textChange.beforeTitle} → {view.proposal.textChange.afterTitle}</dd></div> : null}
        {view.proposal.textChange.beforePurpose !== view.proposal.textChange.afterPurpose ? <div><dt className="font-medium">模块用途</dt><dd>{view.proposal.textChange.beforePurpose} → {view.proposal.textChange.afterPurpose}</dd></div> : null}
      </dl> : null}
      <ul className="space-y-2 text-sm">{view.proposal.changes.map(change=><li key={change.componentId}><span className="font-medium">{change.name}</span>：{view.chartLabels[change.beforeChart]??'当前图形'} → {view.chartLabels[change.afterChart]??'建议图形'}<p className="text-xs leading-5 text-muted-foreground">{change.reason}</p></li>)}</ul>
      {view.preparedBlock?<PreparedBlock block={view.preparedBlock} chartLabels={view.chartLabels}/>:null}
      <p className="text-xs leading-5 text-muted-foreground">改造保留本块指标及业务目标。准备结果来自 EasyV 当前原型；确认后保存该结果。图形示意用于核对内容与位置,真实效果需在 EasyV 中查看。</p>
      {view.error?<p role="alert" className="text-sm text-destructive">{view.error}</p>:null}
      {view.status==='proposal'||view.status==='conflict'||view.status==='failed'?<Button disabled={busy} onClick={()=>void request(`${proposal}/prepare`,'POST')}>{busy?'正在准备…':'准备改造结果'}</Button>:null}
      {canConfirm?<div className="space-y-2"><p className="text-sm">确认将上面的准备结果保存到 EasyV？</p><Button disabled={busy} onClick={()=>void request(`${base}/actions/${encodeURIComponent(view.actionId ?? '')}/confirm`,'POST')}>{busy?'正在保存…':'确认并保存到 EasyV'}</Button></div>:null}
      {canCheck?<Button variant="outline" disabled={busy} onClick={()=>void request(`${base}/actions/${encodeURIComponent(view.actionId ?? '')}/confirm`,'POST')}>{busy?'正在核查…':'核查并恢复同一方案'}</Button>:null}
      {view.status==='verified'?<p className="text-sm text-emerald-700">已读回核对整个原型,所选块与确认结果一致,块外内容保持,编辑上下文已同步。工作台统计会在下一次采集后更新。</p>:null}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">提案当时的判断与信息缺口</summary><ul className="mt-2 space-y-2">{view.proposal.pendingChecks.map((item,i)=><li key={i}>{item}</li>)}</ul></details>
    </div>:null}
  </section>;
}

function PreparedBlock({block,chartLabels}:{block:Record<string,unknown>;chartLabels:Record<string,string>}) {
  const components=Array.isArray(block.components)?block.components:[];
  return <div><p className="mb-2 text-xs font-medium">本次改造内容与位置</p><div className="relative h-72 overflow-hidden rounded-lg border bg-background" aria-label="改造原型块示意">
    {components.map((raw,index)=>{
      if(!raw||typeof raw!=='object')return null;
      const component=raw as Record<string,unknown>;
      const config=component.config&&typeof component.config==='object'?component.config as Record<string,unknown>:{};
      const percent=(value:unknown)=>typeof value==='string'&&/^\d+(\.\d+)?%$/.test(value)?value:undefined;
      return <div key={index} className="absolute flex flex-col items-center justify-center overflow-hidden border border-primary/25 bg-primary/5 p-2 text-center" style={{left:percent(config.relativeX),top:percent(config.relativeY),width:percent(config.width),height:percent(config.height)}}>
        <p className="line-clamp-2 text-sm font-medium">{String(component.metricName??component.name??'指标')}</p><p className="mt-1 text-xs text-muted-foreground">{chartLabels[String(component.chartFamily)]??'图形'}</p>
      </div>;
    })}
  </div></div>;
}
