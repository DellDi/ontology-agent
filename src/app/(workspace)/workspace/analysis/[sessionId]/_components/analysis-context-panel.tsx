'use client';

import { useState, useTransition } from 'react';

import {
  getContextFieldStateLabel,
  type AnalysisContext,
  type AnalysisContextFieldState,
} from '@/domain/analysis-context/models';
import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';

import { Badge } from '@/app/_components/workbench/badge';
import { Button } from '@/app/_components/workbench/button';
import {
  Field,
  FieldInput,
  FieldLabel,
  FieldTextarea,
} from '@/app/_components/workbench/field';
import { StatusBanner } from '@/app/_components/workbench/status-banner';
import { Surface, SurfaceBody, SurfaceHeader } from '@/app/_components/workbench/surface';

type AnalysisContextPanelProps = {
  sessionId: string;
  initialReadModel: AnalysisContextReadModel;
};

type CorrectionDraft = {
  targetMetric: string;
  entity: string;
  timeRange: string;
  comparison: string;
  note: string;
};

type MutableFieldKey = 'targetMetric' | 'entity' | 'timeRange' | 'comparison';

const DEFAULT_DRAFT: CorrectionDraft = {
  targetMetric: '',
  entity: '',
  timeRange: '',
  comparison: '',
  note: '',
};

function getStateBadgeTone(
  state: AnalysisContextFieldState,
): React.ComponentProps<typeof Badge>['tone'] {
  switch (state) {
    case 'confirmed':
      return 'success';
    case 'uncertain':
      return 'warning';
    case 'missing':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function ContextFieldCard({
  label,
  value,
  state,
  note,
}: AnalysisContext['targetMetric']) {
  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Badge tone={getStateBadgeTone(state)}>
          {getContextFieldStateLabel(state)}
        </Badge>
      </div>
      <p className="mt-2 text-base font-medium break-words text-foreground">
        {value}
      </p>
      {note ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}

function buildCorrectionPayload(draft: CorrectionDraft) {
  const payload: Record<string, { value: string; note?: string }> = {};
  const note = draft.note.trim() || undefined;

  (['targetMetric', 'entity', 'timeRange', 'comparison'] as const).forEach(
    (field) => {
      const value = draft[field].trim();

      if (!value) {
        return;
      }

      payload[field] = {
        value,
        note,
      };
    },
  );

  return payload;
}

function buildNextReadModel(
  currentReadModel: AnalysisContextReadModel,
  data: {
    version: number;
    canUndo?: boolean;
    context: AnalysisContext;
    originalQuestionText: string;
  },
): AnalysisContextReadModel {
  return {
    sessionId: currentReadModel.sessionId,
    version: data.version,
    context: data.context,
    canUndo: data.canUndo ?? data.version > 1,
    originalQuestionText: data.originalQuestionText,
  };
}

function CorrectionField({
  label,
  field,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  label: string;
  field: MutableFieldKey;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (field: MutableFieldKey, value: string) => void;
}) {
  return (
    <Field disabled={disabled}>
      <FieldLabel>{label}</FieldLabel>
      <FieldInput
        type="text"
        name={field}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(field, event.currentTarget.value)}
      />
    </Field>
  );
}

export function AnalysisContextPanel({
  sessionId,
  initialReadModel,
}: AnalysisContextPanelProps) {
  const [readModel, setReadModel] = useState(initialReadModel);
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateDraft(field: MutableFieldKey, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  function resetDraft() {
    setDraft(DEFAULT_DRAFT);
  }

  function submitCorrection() {
    const payload = buildCorrectionPayload(draft);

    if (Object.keys(payload).length === 0) {
      setFeedback({
        tone: 'error',
        message: '至少填写一个要修正的字段。',
      });
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/analysis/sessions/${sessionId}/context`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          setFeedback({
            tone: 'error',
            message: data.error ?? '上下文修正失败，请稍后重试。',
          });
          return;
        }

        setReadModel((currentReadModel) =>
          buildNextReadModel(currentReadModel, data),
        );
        resetDraft();
        setFeedback({
          tone: 'success',
          message: `已保存上下文修正，当前版本 v${data.version}。`,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('[analysis-context-panel] 提交上下文修正失败', {
          sessionId,
          detail,
        });
        setFeedback({
          tone: 'error',
          message: `上下文修正失败：${detail}。可重试或刷新页面。`,
        });
      }
    });
  }

  function undoCorrection() {
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/analysis/sessions/${sessionId}/context`,
          {
            method: 'DELETE',
          },
        );

        const data = await response.json();

        if (!response.ok) {
          setFeedback({
            tone: 'error',
            message: data.error ?? '撤销失败，请稍后重试。',
          });
          return;
        }

        setReadModel((currentReadModel) =>
          buildNextReadModel(currentReadModel, data),
        );
        setFeedback({
          tone: 'success',
          message: `已恢复到上一个确认版本，当前版本 v${data.version}。`,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('[analysis-context-panel] 撤销上下文失败', {
          sessionId,
          detail,
        });
        setFeedback({
          tone: 'error',
          message: `撤销失败：${detail}。可重试或刷新页面。`,
        });
      }
    });
  }

  return (
    <Surface data-testid="analysis-context-panel">
      <SurfaceHeader
        eyebrow="分析上下文"
        title={`当前确认版本 v${readModel.version}`}
        description="原始问题保持不变，修正只会生成新的上下文版本，供后续规划与执行继续读取。"
        action={
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={undoCorrection}
            disabled={!readModel.canUndo || isPending}
            loading={isPending && readModel.canUndo}
          >
            撤销上次修正
          </Button>
        }
      />
      <SurfaceBody className="space-y-4">
        <div className="rounded-md border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">原始问题文本</p>
          <p className="mt-2 text-base leading-7 break-words text-foreground">
            {readModel.originalQuestionText}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ContextFieldCard {...readModel.context.targetMetric} />
          <ContextFieldCard {...readModel.context.entity} />
          <ContextFieldCard {...readModel.context.timeRange} />
          <ContextFieldCard {...readModel.context.comparison} />
        </div>

        <div className="rounded-md border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">约束条件</p>
          {readModel.context.constraints.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-foreground">
              {readModel.context.constraints.map((constraint) => (
                <li key={`${constraint.label}-${constraint.value}`} className="break-words">
                  {constraint.label}：{constraint.value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              未识别到明确约束条件（待补充）。
            </p>
          )}
        </div>

        <div className="rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] uppercase text-primary">
                修正上下文
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                只填写你要修正的字段。保存后会生成新的确认版本，后续分析将基于最新版本继续。
              </p>
            </div>
            {feedback ? (
              <StatusBanner
                tone={
                  feedback.tone === 'error'
                    ? 'error'
                    : feedback.tone === 'success'
                      ? 'success'
                      : 'info'
                }
                className="max-w-md"
              >
                {feedback.message}
              </StatusBanner>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <CorrectionField
              label="目标指标"
              field="targetMetric"
              value={draft.targetMetric}
              disabled={isPending}
              placeholder={readModel.context.targetMetric.value}
              onChange={updateDraft}
            />
            <CorrectionField
              label="实体对象"
              field="entity"
              value={draft.entity}
              disabled={isPending}
              placeholder={readModel.context.entity.value}
              onChange={updateDraft}
            />
            <CorrectionField
              label="时间范围"
              field="timeRange"
              value={draft.timeRange}
              disabled={isPending}
              placeholder={readModel.context.timeRange.value}
              onChange={updateDraft}
            />
            <CorrectionField
              label="比较方式"
              field="comparison"
              value={draft.comparison}
              disabled={isPending}
              placeholder={readModel.context.comparison.value}
              onChange={updateDraft}
            />
          </div>

          <Field className="mt-4" disabled={isPending}>
            <FieldLabel>修正说明（可选）</FieldLabel>
            <FieldTextarea
              name="note"
              placeholder="例如：把比较基线改成同比，或把指标口径限定为不含预缴。"
              value={draft.note}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  note: event.currentTarget.value,
                }))
              }
            />
          </Field>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="primary"
              type="button"
              onClick={submitCorrection}
              loading={isPending}
            >
              保存上下文修正
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                resetDraft();
                setFeedback({
                  tone: 'info',
                  message: '已清空本次待提交的修正草稿。',
                });
              }}
              disabled={isPending}
            >
              清空草稿
            </Button>
          </div>
        </div>
      </SurfaceBody>
    </Surface>
  );
}
