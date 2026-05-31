'use client';

import { useState } from 'react';

import type {
  SubStepEntry,
  ToolTimelineEntry,
} from '@/application/analysis-message-projection/conversation-view-model';
import { translateToolName } from '@/application/analysis-message-projection/conversation-view-model';

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
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brand-500)] opacity-40" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-[color:var(--brand-500)]" />
        </span>
      );
    case 'completed':
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white">
          ✓
        </span>
      );
    case 'failed':
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] text-white">
          ✕
        </span>
      );
  }
}

function SubStepStatusIndicator({ status }: { status: SubStepEntry['status'] }) {
  switch (status) {
    case 'running':
      return (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--brand-500)]" />
      );
    case 'completed':
      return (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
      );
    case 'failed':
      return (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" />
      );
  }
}

// ---------------------------------------------------------------------------
// 子步骤（展开后可见）
// ---------------------------------------------------------------------------

function SubStepRow({ subStep }: { subStep: SubStepEntry }) {
  return (
    <li className="flex items-start gap-2 text-xs text-[color:var(--ink-600)]">
      <span className="mt-1.5">
        <SubStepStatusIndicator status={subStep.status} />
      </span>
      <div className="flex-1">
        <p className="leading-6">
          <span className="font-medium text-[color:var(--ink-900)]">
            {translateToolName(subStep.toolName)}
          </span>
          <span className="mx-1 text-[color:var(--ink-600)]/60">·</span>
          <span>{subStep.objective}</span>
        </p>
        {subStep.result ? (
          <p className="mt-0.5 text-[11px] leading-5 text-[color:var(--ink-600)]/80">
            {subStep.result}
          </p>
        ) : null}
      </div>
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
    <li className="relative pl-6 pb-4 last:pb-0">
      {/* 垂直连线 */}
      <span
        aria-hidden
        className="absolute left-[5px] top-3 bottom-0 w-px bg-[color:var(--line-200)] last:hidden"
      />

      {/* 状态点 */}
      <span className="absolute left-0 top-1.5">
        <StepStatusIndicator status={entry.status} />
      </span>

      {/* 主行（可点击展开） */}
      <button
        className={`flex w-full items-center gap-2 text-left text-sm ${
          hasSubSteps
            ? 'cursor-pointer text-[color:var(--ink-900)] hover:text-[color:var(--brand-700)]'
            : 'cursor-default text-[color:var(--ink-900)]'
        }`}
        onClick={() => {
          if (hasSubSteps) setExpanded((prev) => !prev);
        }}
        type="button"
        disabled={!hasSubSteps}
      >
        <span className="flex-1 font-medium leading-6">{entry.stepName}</span>
        {entry.duration ? (
          <span className="text-xs text-[color:var(--ink-600)]">
            {entry.duration}
          </span>
        ) : null}
        {hasSubSteps ? (
          <span
            className={`text-[color:var(--ink-600)] transition-transform ${
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
        <ul className="mt-2 space-y-1.5 border-l border-dashed border-[color:var(--line-200)] pl-3">
          {entry.subSteps.map((subStep, index) => (
            <SubStepRow
              key={`${subStep.toolName}::${subStep.objective}::${index}`}
              subStep={subStep}
            />
          ))}
        </ul>
      ) : null}

      {entry.details ? (
        <p className="mt-1 text-xs leading-5 text-[color:var(--ink-600)]/80">
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
    <div className="mt-4 rounded-xl border border-[color:var(--line-200)] bg-white/60 px-4 py-3">
      <p className="mb-2 text-xs font-medium tracking-[0.15em] text-[color:var(--ink-600)] uppercase">
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
