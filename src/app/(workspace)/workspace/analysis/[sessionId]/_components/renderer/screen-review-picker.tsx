'use client';

import { useState } from 'react';
import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';
import type { JavaObjectReadResult } from '@/infrastructure/java-backend/object-read-contract';
import { javaObjectSelectionSchema } from '@/infrastructure/java-backend/object-read-contract';
import { objectRecordTitle } from '@/application/object-collection/presentation';
import { Button } from '@/components/ui/button';

export function ScreenReviewPicker({ executionId, data, onStart }: {
  executionId: string;
  data?: JavaObjectReadResult;
  onStart: (selection: AnalysisObjectSelection, label: string, question?: string) => void;
}) {
  const [selected, setSelected] = useState<{ setId: string; rows: JavaObjectReadResult['page']['rows']; type: JavaObjectReadResult['objectType'] } | null>(null);
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const rows = selected?.rows ?? [];
  const changed = !!selected && !!data && selected.setId !== data.datasetVersionSetId;

  return <form className="space-y-4" aria-label="一起检查大屏" onSubmit={event => {
    event.preventDefault();
    if (!data || !rows.length || changed || !purpose.trim()) return;
    const selection = javaObjectSelectionSchema.parse({ executionId, datasetVersionSetId: selected!.setId,
      reference: rows[0].reference, ...(rows.length > 1 ? { additionalReferences: rows.slice(1).map(row => row.reference) } : {}) });
    onStart(selection, `${rows.length} 张大屏的检查与改进`,
      `请检查所选大屏。用途：${purpose.trim()}\n逐屏结合主题、模块目的与指标检查内容安排，说明重点问题及依据，为支持的调整准备尚未应用的改造提案；明确无需修改、证据不足或超出能力的部分。`);
  }}>
    <p className="text-sm text-muted-foreground">选择最多三张大屏，说明这次要用它们完成什么工作。</p>
    <div className="space-y-1">
      {(data?.page.rows ?? []).map(row => <label key={row.reference.objectId} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-3 text-sm hover:bg-muted">
        <input type="checkbox" className="mt-1" checked={rows.some(item => item.reference.objectId === row.reference.objectId)} disabled={changed} onChange={event => {
          if (!data) return;
          setError('');
          if (event.target.checked && rows.length === 3) { setError('每次最多检查三张大屏，请先取消一张。'); return; }
          const next = event.target.checked ? [...rows, row] : rows.filter(item => item.reference.objectId !== row.reference.objectId);
          setSelected(next.length ? { setId: data.datasetVersionSetId, rows: next, type: data.objectType } : null);
        }} />
        <span>{objectRecordTitle(row.properties, data?.objectType)}</span>
      </label>)}
    </div>
    {rows.length ? <p className="text-xs leading-5 text-muted-foreground">已选 {rows.length} 张：{rows.map(row => objectRecordTitle(row.properties, selected!.type)).join('、')} <button className="ml-2 py-1 text-primary hover:underline" type="button" onClick={() => { setSelected(null); setError(''); }}>清空选择</button></p> : null}
    {changed ? <p role="alert" className="text-sm text-destructive">数据版本已更新，请清空选择后重新选择，避免混用两批数据。</p> : null}
    <label className="block space-y-2 text-sm">
      <span className="font-medium">这批大屏要用来做什么？</span>
      <textarea required maxLength={180} value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="例如：用于运营复盘，先看总览，再看变化和原因。请保留现有指标。" className="min-h-24 w-full rounded-md bg-muted/50 p-3 focus-visible:outline-2 focus-visible:outline-ring" />
    </label>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-4">
      <Button type="submit" disabled={!data || !rows.length || changed || !purpose.trim()}>检查并准备改法</Button>
      <p className="text-xs text-muted-foreground">先查看建议与预览，保存时逐项确认。</p>
    </div>
  </form>;
}
