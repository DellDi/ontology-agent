'use client';

import { useState } from 'react';

import {
  buildStructuredQueries,
  structuredAdjustmentQuestion,
  structuredDraftFromIntent,
  validateStructuredDraft,
  type StructuredCompareMode,
  type StructuredQueryDraft,
  type StructuredTimeKind,
  type StructuredTimeUnit,
} from '@/application/analysis-message-projection/structured-adjustment';
import {
  type SemanticEditorCatalog,
  type SemanticQueryUnderstanding,
  type ResolvedQueryIntent,
} from '@/application/analysis-message-projection/semantic-understanding';
import { WorkbenchSheet } from '@/app/_components/workbench/workbench-sheet';
import { Button } from '@/app/_components/workbench/button';

const SELECT_STYLES =
  'rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60';
const INPUT_STYLES =
  'rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60';

const TIME_KIND_OPTIONS: { value: StructuredTimeKind; label: string }[] = [
  { value: 'relative', label: '最近 N' },
  { value: 'calendar', label: '自然周期' },
  { value: 'to-date', label: '本期以来' },
  { value: 'absolute', label: '指定日期' },
  { value: 'all', label: '全部数据' },
];

const UNIT_OPTIONS: { value: StructuredTimeUnit; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季度' },
  { value: 'year', label: '年' },
];

const TO_DATE_UNIT_OPTIONS = UNIT_OPTIONS.filter((item) => item.value !== 'day');
const GRANULARITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '不分桶' },
  ...UNIT_OPTIONS.map((item) => ({
    value: item.value,
    label: `按${item.label}`,
  })),
];

function updateDraft(
  drafts: StructuredQueryDraft[],
  id: string,
  patch: Partial<StructuredQueryDraft>,
): StructuredQueryDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft));
}

function toggleMember(list: string[], key: string): string[] {
  return list.includes(key)
    ? list.filter((item) => item !== key)
    : [...list, key];
}

function MemberChecklist({
  title,
  members,
  selected,
  onToggle,
}: {
  title: string;
  members: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold text-foreground">{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {members.map((member) => {
          const active = selected.includes(member.key);
          return (
            <button
              aria-pressed={active}
              className={
                active
                  ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary'
                  : 'rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }
              key={member.key}
              onClick={() => onToggle(member.key)}
              type="button"
            >
              {member.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function QueryEditor({
  catalogObject,
  draft,
  onChange,
}: {
  catalogObject: SemanticEditorCatalog['objects'][number] | undefined;
  draft: StructuredQueryDraft;
  onChange: (patch: Partial<StructuredQueryDraft>) => void;
}) {
  const allDataTime = draft.timeKind === 'all';
  return (
    <div className="space-y-4">
      <MemberChecklist
        members={catalogObject?.measures ?? []}
        onToggle={(key) =>
          onChange({ measures: toggleMember(draft.measures, key) })
        }
        selected={draft.measures}
        title="指标（至少一项）"
      />
      <MemberChecklist
        members={catalogObject?.dimensions ?? []}
        onToggle={(key) =>
          onChange({ dimensions: toggleMember(draft.dimensions, key) })
        }
        selected={draft.dimensions}
        title="维度"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-semibold text-foreground">
          时间属性
          <select
            className={`${SELECT_STYLES} mt-1 w-full`}
            onChange={(event) =>
              onChange({ timeDimension: event.target.value || null })
            }
            value={draft.timeDimension ?? ''}
          >
            {!draft.timeDimension ? <option value="">对象默认</option> : null}
            {(catalogObject?.timeDimensions ?? []).map((member) => (
              <option key={member.key} value={member.key}>
                {member.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-foreground">
          粒度
          <select
            className={`${SELECT_STYLES} mt-1 w-full`}
            onChange={(event) =>
              onChange({
                granularity: (event.target.value || null) as StructuredTimeUnit | null,
              })
            }
            value={draft.granularity ?? ''}
          >
            {GRANULARITY_OPTIONS.map((item) => (
              <option key={item.value || 'none'} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-foreground">时间</label>
        <select
          className={`${SELECT_STYLES} w-full`}
          onChange={(event) =>
            onChange({ timeKind: event.target.value as StructuredTimeKind })
          }
          value={draft.timeKind}
        >
          {TIME_KIND_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {draft.timeKind === 'relative' ? (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">最近</span>
            <input
              className={`${INPUT_STYLES} w-24`}
              max={1000}
              min={1}
              onChange={(event) =>
                onChange({ relativeN: Number(event.target.value) })
              }
              type="number"
              value={draft.relativeN}
            />
            <select
              className={SELECT_STYLES}
              onChange={(event) =>
                onChange({ relativeUnit: event.target.value as StructuredTimeUnit })
              }
              value={draft.relativeUnit}
            >
              {UNIT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {draft.timeKind === 'calendar' ? (
          <div className="mt-2 flex items-center gap-2">
            <select
              className={SELECT_STYLES}
              onChange={(event) =>
                onChange({ calendarUnit: event.target.value as StructuredTimeUnit })
              }
              value={draft.calendarUnit}
            >
              {UNIT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">偏移</span>
            <input
              className={`${INPUT_STYLES} w-24`}
              max={0}
              onChange={(event) =>
                onChange({ calendarOffset: Number(event.target.value) })
              }
              type="number"
              value={draft.calendarOffset}
            />
            <span className="text-xs text-muted-foreground">0 为本期，-1 为上期</span>
          </div>
        ) : null}
        {draft.timeKind === 'to-date' ? (
          <select
            className={`${SELECT_STYLES} mt-2 w-full`}
            onChange={(event) =>
              onChange({ toDateUnit: event.target.value as Exclude<StructuredTimeUnit, 'day'> })
            }
            value={draft.toDateUnit}
          >
            {TO_DATE_UNIT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}
        {draft.timeKind === 'absolute' ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              className={INPUT_STYLES}
              onChange={(event) => onChange({ absoluteFrom: event.target.value })}
              type="date"
              value={draft.absoluteFrom}
            />
            <span className="text-sm text-muted-foreground">至</span>
            <input
              className={INPUT_STYLES}
              onChange={(event) => onChange({ absoluteTo: event.target.value })}
              type="date"
              value={draft.absoluteTo}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-foreground">对比</label>
        <select
          className={`${SELECT_STYLES} w-full`}
          disabled={allDataTime}
          onChange={(event) =>
            onChange({ compareMode: event.target.value as StructuredCompareMode })
          }
          value={allDataTime ? 'none' : draft.compareMode}
        >
          <option value="none">无</option>
          {draft.compareMode === 'keep'
            || draft.sourceIntent.compare ? (
            <option value="keep">保持原对比</option>
          ) : null}
          <option value="absolute">指定日期</option>
        </select>
        {allDataTime ? (
          <p className="text-xs text-muted-foreground">全部数据不支持对比区间</p>
        ) : null}
        {draft.compareMode === 'absolute' && !allDataTime ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              className={INPUT_STYLES}
              onChange={(event) => onChange({ compareFrom: event.target.value })}
              type="date"
              value={draft.compareFrom}
            />
            <span className="text-sm text-muted-foreground">至</span>
            <input
              className={INPUT_STYLES}
              onChange={(event) => onChange({ compareTo: event.target.value })}
              type="date"
              value={draft.compareTo}
            />
          </div>
        ) : null}
      </div>

      {draft.filters.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-foreground">过滤</legend>
          <div className="flex flex-wrap gap-1.5">
            {draft.filters.map((filter, index) => (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
                key={`${filter.member}-${index}`}
              >
                {filter.member} {filter.operator}
                {filter.values.length > 0 ? ` ${filter.values.join('、')}` : ''}
                <button
                  aria-label={`移除过滤 ${filter.member}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onChange({
                      filters: draft.filters.filter((_, i) => i !== index),
                    })
                  }
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className="space-y-1.5 text-sm font-semibold text-foreground">
        Top N（可选，1-1000）
        <input
          className={`${INPUT_STYLES} mt-1 w-32`}
          max={1000}
          min={1}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ limit: value === '' ? null : Number(value) });
          }}
          placeholder="不限"
          type="number"
          value={draft.limit ?? ''}
        />
      </label>
    </div>
  );
}

export function AnalysisUnderstandingEditor({
  catalog,
  onClose,
  onSubmit,
  open,
  resolvedQueries,
  serverError,
  submitting,
  understanding,
}: {
  understanding: SemanticQueryUnderstanding[];
  resolvedQueries: ResolvedQueryIntent[];
  catalog: SemanticEditorCatalog;
  open: boolean;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (payload: {
    question: string;
    queries: { id: string; intent: Record<string, unknown> }[];
  }) => void;
  onClose: () => void;
}) {
  // 草稿按 turn 初始化；编辑过程仅本地状态，提交时才生成 intent 与摘要
  const [drafts, setDrafts] = useState<StructuredQueryDraft[]>(() =>
    understanding.map((entry) => {
      const resolved = resolvedQueries.find((item) => item.id === entry.id);
      const catalogObject = catalog.objects.find(
        (item) => item.key === entry.object.key,
      );
      return structuredDraftFromIntent(
        entry.id,
        resolved?.intent ?? {},
        catalogObject,
        entry.label,
      );
    }),
  );
  const [errors, setErrors] = useState<string[]>([]);

  const handleSubmit = () => {
    const found = drafts.flatMap((draft) =>
      validateStructuredDraft(
        draft,
        catalog.objects.find((item) => item.key === draft.object),
      ),
    );
    setErrors(found);
    if (found.length > 0) return;
    onSubmit({
      question: structuredAdjustmentQuestion(drafts),
      queries: buildStructuredQueries(drafts),
    });
  };

  return (
    <WorkbenchSheet
      description="修改查询的对象成员、时间与对比方式；提交后按调整重新分析。"
      onClose={onClose}
      open={open}
      testId="analysis-understanding-editor"
      title="调整我的理解"
    >
      <div className="space-y-6">
        {drafts.map((draft, index) => {
          const catalogObject = catalog.objects.find(
            (item) => item.key === draft.object,
          );
          return (
            <section
              className="space-y-4 rounded-lg border border-border p-4"
              key={draft.id}
            >
              <p className="text-sm font-semibold text-foreground">
                {drafts.length > 1 ? `查询 ${index + 1} · ` : ''}
                {catalogObject?.label ?? draft.object}
                {draft.label ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {draft.label}
                  </span>
                ) : null}
              </p>
              <QueryEditor
                catalogObject={catalogObject}
                draft={draft}
                onChange={(patch) =>
                  setDrafts((current) => updateDraft(current, draft.id, patch))
                }
              />
            </section>
          );
        })}

        {errors.length > 0 ? (
          <ul
            className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            role="alert"
          >
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        {serverError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {serverError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="secondary">
            取消
          </Button>
          <Button disabled={submitting} onClick={handleSubmit} type="button">
            {submitting ? '提交中…' : '应用调整'}
          </Button>
        </div>
      </div>
    </WorkbenchSheet>
  );
}
