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

function SubStepStatusIndicator({ status }: { status: SubStepEntry['status'] }) {
  switch (status) {
    case 'running':
      return (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
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
// JSON 详情（工具输入/输出）
// ---------------------------------------------------------------------------

function JsonDetail({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const keys = Object.keys(value);
  if (keys.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        className="text-[10px] text-muted-foreground/60 hover:text-primary"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
        type="button"
      >
        {expanded ? '收起' : `查看${label}`}
      </button>
      {expanded ? (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[10px] leading-4 text-muted-foreground">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子步骤（展开后可见）
// ---------------------------------------------------------------------------

function SubStepRow({ subStep }: { subStep: SubStepEntry }) {
  const displayName = subStep.toolLabel || translateToolName(subStep.toolName);

  return (
    <li className="flex items-start gap-2 text-xs text-muted-foreground">
      <span className="mt-1.5">
        <SubStepStatusIndicator status={subStep.status} />
      </span>
      <div className="flex-1">
        <p className="leading-6">
          <span className="font-medium text-foreground">
            {displayName}
          </span>
          {subStep.objective && subStep.objective !== displayName ? (
            <>
              <span className="mx-1 text-muted-foreground/60">·</span>
              <span>{subStep.objective}</span>
            </>
          ) : null}
          {subStep.duration ? (
            <span className="ml-2 text-[11px] text-muted-foreground/70">
              {subStep.duration}
            </span>
          ) : null}
        </p>
        {subStep.result ? (
          <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground/80">
            {subStep.result}
          </p>
        ) : null}
        {subStep.error ? (
          <p className="mt-0.5 text-[11px] leading-5 text-rose-500">
            {subStep.error}
          </p>
        ) : null}
        {subStep.input ? (
          <JsonDetail label="输入" value={subStep.input} />
        ) : null}
        {subStep.output ? (
          <JsonDetail label="输出" value={subStep.output} />
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
        className="absolute left-[5px] top-3 bottom-0 w-px bg-border last:hidden"
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
