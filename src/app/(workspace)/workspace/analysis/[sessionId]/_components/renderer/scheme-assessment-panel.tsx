'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';
import { assessAnalysisScheme } from '@/infrastructure/java-backend/scheme-assessment-client';
import type { JavaSchemeAssessmentResult } from '@/infrastructure/java-backend/scheme-assessment-contract';

type Comparison = NonNullable<JavaSchemeAssessmentResult['comparison']>;
type Assessment = Comparison['current'];
const statuses = { feasible: '可行', infeasible: '不满足约束', unassessable: '信息不足' };
const reasons: Record<string, string> = {
  SCHEME_LIBRARY_NOT_RETAINED: '本轮历史版本尚未包含方案库。重新采集并发布后，新分析才能比较方案。',
  SCHEME_CANDIDATES_NOT_RETAINED: '本轮冻结方案库没有该区域类型的候选方案。',
};

function AssessmentCard({ title, assessment, input, baseline }: { title: string; assessment: Assessment; input: Comparison['input']; baseline?: number | null }) {
  const [details, setDetails] = useState(false);
  const delta = assessment.score !== null && baseline != null ? assessment.score - baseline : null;
  const bounds = input.bounds;
  return <article className="space-y-3 rounded-xl border border-border bg-background p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h5 className="text-sm font-semibold">{title}</h5><p className="mt-1 text-xs text-muted-foreground">方案 {assessment.schemeId ?? '未保留'}</p></div>
      <div className="text-right"><p className="flex items-center justify-end gap-1.5 text-xs font-medium">
        {assessment.status === 'feasible' ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden /> : <CircleAlert className="size-3.5 text-amber-600" aria-hidden />}{statuses[assessment.status]}</p>
        {assessment.score !== null ? <p className="mt-1 text-lg font-semibold tabular-nums">{assessment.score.toFixed(1)}<span className="ml-1 text-xs font-normal text-muted-foreground">/ 100</span></p> : null}
        {delta !== null ? <p className="text-xs text-muted-foreground">较当前 {delta >= 0 ? '+' : ''}{delta.toFixed(1)}</p> : null}
      </div>
    </div>
    {bounds && assessment.assignments.length ? <div className="relative overflow-hidden rounded-md border border-border bg-muted/30" style={{ aspectRatio: `${bounds.width} / ${bounds.height}`, maxHeight: 220 }} aria-label={`${title}的指标分配示意`}>
      {assessment.assignments.map((a) => <div key={a.slotIndex} className="absolute flex flex-col items-center justify-center overflow-hidden rounded-sm border border-primary/25 bg-primary/10 px-1 text-center text-[10px] text-primary"
        style={{ left: `${(a.bounds.x - bounds.x) / bounds.width * 100}%`, top: `${(a.bounds.y - bounds.y) / bounds.height * 100}%`, width: `${a.bounds.width / bounds.width * 100}%`, height: `${a.bounds.height / bounds.height * 100}%` }}>
        <span className="max-w-full truncate">槽位 {a.slotIndex + 1} · {a.chartFamily}</span><span className="max-w-full truncate">{a.metricId}</span>
      </div>)}
    </div> : null}
    {assessment.findings.length ? <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">{[...new Set(assessment.findings.map((f) => f.message))].map((message) => <li key={message}>{message}</li>)}</ul> : null}
    <Button type="button" variant="ghost" size="sm" aria-expanded={details} onClick={() => setDetails(!details)}>{details ? '收起依据' : '查看评估依据'}</Button>
    {details ? <div className="space-y-2 border-t border-border pt-3 text-xs">
      {assessment.assignments.map((a) => <div key={a.slotIndex} className="space-y-1"><p className="break-all font-medium">槽位 {a.slotIndex + 1} → 指标 {a.metricId} · 组件 {a.componentId}</p>
        <p className="text-muted-foreground">有效尺寸 {a.bounds.width.toFixed(1)} × {a.bounds.height.toFixed(1)} px；阈值 {a.minimum.width} × {a.minimum.height} px</p>
        <p className="text-muted-foreground">可读余量 {a.readability.toFixed(1)} · 角色 {a.role.toFixed(1)} · 位置 {a.position.toFixed(1)}</p></div>)}
      {assessment.findings.map((f, index) => <p key={index} className="break-all text-muted-foreground">{f.slotIndex !== null ? `槽位 ${f.slotIndex + 1} · ` : ''}{f.componentId ? `${f.componentId} · ` : ''}{f.code}</p>)}
    </div> : null}
  </article>;
}

export function SchemeAssessmentPanel({ sessionId, selection, initialResult }: { sessionId: string; selection: AnalysisObjectSelection; initialResult?: JavaSchemeAssessmentResult }) {
  const assessment = useMutation({ mutationFn: () => assessAnalysisScheme(sessionId, selection), retry: false });
  const [expanded, setExpanded] = useState(false);
  const result = assessment.data ?? initialResult;
  const comparison = result?.comparison;
  const candidates = comparison?.candidates ?? [];
  return <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-4" aria-label="区域方案比较">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-semibold">区域方案比较</h4>
      <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">固定本轮指标和区域尺寸，检查候选方案能否放下并满足类型约束。</p></div>
      <Button type="button" variant="outline" size="sm" disabled={assessment.isPending} onClick={() => assessment.mutate()}>
        {assessment.isPending ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden /> : null}{assessment.isPending ? '正在评估…' : result ? '重新评估' : '评估候选方案'}</Button></div>
    {assessment.isPending ? <p className="text-xs text-muted-foreground" role="status">正在检查冻结输入、槽位约束和指标分配。</p> : null}
    {assessment.error ? <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{assessment.error.message}</p> : null}
    {result?.reason ? <div className="rounded-lg border border-border bg-background p-4"><p className="text-sm font-medium">暂时无法比较</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{reasons[result.reason] ?? result.reason}</p></div> : null}
    {comparison ? <>
      <p className="text-xs leading-5 text-muted-foreground">以下为适配评估，使用尚待真实数据校准的规则。分数表示可行分配的相对适配程度，与历史生成评分分别保留。</p>
      <AssessmentCard title="当前方案 · 源组件位置" assessment={comparison.current} input={comparison.input} />
      <div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-medium">候选方案 · {candidates.length} 项</span><span className="text-muted-foreground">可行项按适配分排序</span></div>
      <div className="grid items-start gap-3 min-[720px]:grid-cols-2">{(expanded ? candidates : candidates.slice(0, 6)).map((candidate) => <AssessmentCard key={candidate.schemeId} title={`候选方案 ${candidate.schemeId}`}
        assessment={candidate} input={comparison.input} baseline={comparison.current.score} />)}</div>
      {candidates.length > 6 ? <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起候选' : `查看其余 ${candidates.length - 6} 项候选`}</Button> : null}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">规则与版本证据</summary><div className="mt-2 space-y-1.5 break-all leading-5">
        <p>规则 {comparison.rules.version}；权重：可读余量 {comparison.rules.readabilityWeight}% / 角色 {comparison.rules.roleWeight}% / 位置 {comparison.rules.positionWeight}%</p>
        <p>评估边距 {comparison.rules.inset} px；有标题时预留 {comparison.rules.titleReserve} px；组件间距 {comparison.rules.gap} px。此处为原型适配阈值。</p>
        <p>评估 ID：{result?.assessmentId}</p><p>冻结集合：{selection.datasetVersionSetId}</p>
        {Object.entries(result?.productVersionIds ?? {}).filter(([key]) => ['easyv-prototype-layout', 'easyv-prototype-block', 'easyv-prototype-component', 'easyv-scheme-library'].includes(key)).map(([key, version]) => <p key={key}>{key}：{version}</p>)}
      </div></details>
    </> : null}
  </section>;
}
