'use client';

import { useState } from 'react';

import type {
  SubStepEntry,
  ToolTimelineEntry,
} from '@/application/analysis-message-projection/conversation-view-model';
import { translateToolName } from '@/application/analysis-message-projection/conversation-view-model';
import {
  toToolPartState,
  toToolType,
} from '@/application/analysis-message-projection/ai-elements-mapping';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';

// ---------------------------------------------------------------------------
// 状态图标
// ---------------------------------------------------------------------------

function StepStatusIndicator({
  status,
}: {
  status: ToolTimelineEntry['status'];
}) {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
        </span>
      );
    case 'completed':
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-primary-foreground">
          ✓
        </span>
      );
    case 'failed':
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] text-primary-foreground">
          ✕
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// 子步骤（AI Elements Tool 卡片：状态徽标 + 可展开输入/输出）
// ---------------------------------------------------------------------------

function SubStepRow({ subStep }: { subStep: SubStepEntry }) {
  const displayName = subStep.toolLabel || translateToolName(subStep.toolName);
  const title =
    subStep.objective && subStep.objective !== displayName
      ? `${displayName} · ${subStep.objective}`
      : displayName;

  return (
    <li>
      <Tool className="mb-1" defaultOpen={subStep.status === 'failed'}>
        <ToolHeader
          state={toToolPartState(subStep.status)}
          title={
            subStep.duration ? `${title} · ${subStep.duration}` : title
          }
          type={toToolType(subStep.toolName)}
        />
        <ToolContent>
          {subStep.result ? (
            <p className="px-4 pt-3 text-xs leading-5 text-muted-foreground/80">
              {subStep.result}
            </p>
          ) : null}
          {subStep.input ? <ToolInput input={subStep.input} /> : null}
          <ToolOutput errorText={subStep.error} output={subStep.output} />
        </ToolContent>
      </Tool>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 单条步骤行
// ---------------------------------------------------------------------------

function TimelineStepRow({ entry }: { entry: ToolTimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasSubSteps = entry.subSteps.length > 0;

  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      {/* 垂直连线 */}
      <span
        aria-hidden
        className="absolute bottom-0 left-[5px] top-3 w-px bg-border last:hidden"
      />

      {/* 状态点 */}
      <span className="absolute left-0 top-1.5">
        <StepStatusIndicator status={entry.status} />
      </span>

      {/* 主行（可点击展开） */}
      <button
        className={`flex w-full items-center gap-2 text-left text-sm ${
          hasSubSteps
            ? 'cursor-pointer text-foreground hover:text-primary'
            : 'cursor-default text-foreground'
        }`}
        onClick={() => {
          if (hasSubSteps) setExpanded((prev) => !prev);
        }}
        type="button"
        disabled={!hasSubSteps}
      >
        <span className="flex-1 font-medium leading-6">{entry.stepName}</span>
        {entry.duration ? (
          <span className="text-xs text-muted-foreground">
            {entry.duration}
          </span>
        ) : null}
        {hasSubSteps ? (
          <span
            className={`text-muted-foreground transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
            aria-hidden
          >
            ›
          </span>
        ) : null}
      </button>

      {/* 详情（展开后可见） */}
      {expanded && hasSubSteps ? (
        <ul className="mt-2 space-y-1.5 border-l border-dashed border-border pl-3">
          {entry.subSteps.map((subStep, index) => (
            <SubStepRow
              key={`${subStep.toolName}::${subStep.objective}::${index}`}
              subStep={subStep}
            />
          ))}
        </ul>
      ) : null}

      {entry.details ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground/80">
          {entry.details}
        </p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function AnalysisStepTimeline({
  entries,
}: {
  entries: ToolTimelineEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
      <p className="mb-2 text-xs font-medium tracking-[0.1em] text-muted-foreground">
        分析过程
      </p>
      <ol className="space-y-0">
        {entries.map((entry) => (
          <TimelineStepRow key={entry.stepId} entry={entry} />
        ))}
      </ol>
    </div>
  );
}
