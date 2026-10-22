'use client';

import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react';

import type {
  SubStepEntry,
  ToolTimelineEntry,
} from '@/application/analysis-message-projection/conversation-view-model';
import { translateToolName } from '@/application/analysis-message-projection/tool-name-translations';
import { CollapsibleSection } from './collapsible-section';

/** 只解释事件已经返回的信息，不从完成状态推断业务结论。 */
function resultSummary(step: SubStepEntry): string {
  if (step.result) return step.result;
  const output = step.output;
  if (!output) return '';

  // 文案提案没有图形变更行，rows=0 不代表没有生成提案。
  if (step.status === 'completed' && Array.isArray(step.input?.choices)) {
    if (typeof step.input.title === 'string') return `建议标题「${step.input.title}」 · 尚未应用`;
    if (typeof step.input.purpose === 'string') return `建议用途「${step.input.purpose}」 · 尚未应用`;
  }

  const parts: string[] = [];
  if (typeof output.rows === 'number') parts.push(`返回 ${output.rows} 条记录`);
  if (typeof output.compareRows === 'number' && output.compareRows > 0) {
    parts.push(`对比期 ${output.compareRows} 条记录`);
  }
  if (typeof output.claimCount === 'number') parts.push(`${output.claimCount} 项结论`);
  if (typeof output.evidenceCount === 'number') parts.push(`${output.evidenceCount} 项依据`);
  return parts.join(' · ');
}

function ProcessRow({
  title,
  summary,
  scope,
  status,
  duration,
  error,
}: {
  title: string;
  summary?: string;
  scope?: string;
  status: ToolTimelineEntry['status'];
  duration?: string;
  error?: string;
}) {
  const Icon = status === 'running' ? LoaderCircleIcon : status === 'failed' ? XIcon : CheckIcon;
  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      <Icon aria-hidden className={`absolute left-0 top-1 size-4 ${
        status === 'running' ? 'animate-spin motion-reduce:animate-none text-primary'
          : status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
      }`} />
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-6 text-foreground">
          {title}
          <span className="sr-only">（{status === 'running' ? '执行中' : status === 'failed' ? '失败' : '已完成'}）</span>
        </p>
        {duration ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration}</span> : null}
      </div>
      {scope ? <p className="text-xs leading-5 text-muted-foreground">{scope}</p> : null}
      {summary ? <p className="text-xs leading-5 text-muted-foreground">{summary}</p> : null}
      {error ? <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-destructive">{error}</p> : null}
    </li>
  );
}

export function AnalysisStepTimeline({ entries }: { entries: ToolTimelineEntry[] }) {
  const rows = entries.flatMap((entry) => {
    const tools = entry.subSteps.flatMap((step, index) => {
      const name = step.toolLabel || translateToolName(step.toolName);
      const objective = step.objective && step.objective !== name ? step.objective : '';
      const summary = resultSummary(step);
      // 完成但没有可读结果的调度节点不占据用户的分析过程。
      if (step.status === 'completed' && !summary && !objective && !step.error) return [];
      return [<ProcessRow key={`${entry.stepId}:${index}`} title={name}
        scope={typeof step.input?.dataScope === 'string' ? step.input.dataScope : undefined}
        summary={[objective, summary].filter(Boolean).join(' · ')}
        status={step.status} duration={step.duration} error={step.error} />];
    });
    if (entry.status !== 'completed' && !entry.subSteps.some((step) => step.status === entry.status)) {
      tools.push(<ProcessRow key={entry.stepId} title={entry.stepName} status={entry.status}
        duration={entry.duration} summary={entry.details} />);
    }
    return tools;
  });

  if (rows.length === 0) return null;
  return (
    <CollapsibleSection title="查看分析过程">
      <ol aria-label="分析过程" className="py-1">{rows}</ol>
    </CollapsibleSection>
  );
}
