'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import type { CandidateValidationSummary } from '@/application/analysis-message-projection/candidate-validation-model';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';

function CandidateValidationStatusBadge({
  status,
}: {
  status: CandidateValidationSummary['validations'][number]['status'];
}) {
  const toneMap: Record<
    CandidateValidationSummary['validations'][number]['status'],
    { className: string; label: string }
  > = {
    supported: {
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: '已核验',
    },
    'not-supported': {
      className: 'bg-rose-50 text-rose-700 border-rose-200',
      label: '未发现支持数据',
    },
    inconclusive: {
      className: 'bg-amber-50 text-amber-700 border-amber-200',
      label: '需人工确认',
    },
    'not-validated': {
      className: 'bg-slate-50 text-slate-500 border-slate-200',
      label: '尚未核验',
    },
  };
  const tone = toneMap[status];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone.className}`}
    >
      {tone.label}
    </span>
  );
}

/**
 * 诊断信息面板 — 展示候选因素验证结论、timeline、process-board、render errors 和其他诊断块。
 * 用于"诊断信息"抽屉，默认隐藏，不进入主聊天阅读流。
 *
 * AC6：诊断面板必须说明每个候选因素的验证结果、证据、是否进入最终判断。
 */
export function AnalysisDiagnosticsPanel({
  timelineBlocks,
  processBoardBlocks,
  renderErrors,
  otherBlocks,
  eventCount,
  lastSequence,
  executionId,
  candidateValidation,
}: {
  timelineBlocks: AnalysisRenderedBlock[];
  processBoardBlocks: AnalysisRenderedBlock[];
  renderErrors: AnalysisRenderedBlock[];
  otherBlocks: AnalysisRenderedBlock[];
  eventCount: number;
  lastSequence: number;
  executionId?: string;
  candidateValidation: CandidateValidationSummary;
}) {
  const registry = getDefaultAnalysisInteractionUiRendererRegistry();
  const completedCount =
    candidateValidation.supportedCount + candidateValidation.notSupportedCount;

  return (
    <div className="space-y-6">
      {candidateValidation.validations.length > 0 ? (
        <section data-testid="candidate-validation-section">
          <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
            候选原因核验结果
          </h4>
          <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
            系统已经对 {candidateValidation.totalFactors} 个候选方向做了数据核验；
            {completedCount} 个已有明确核验结果，
            {candidateValidation.includedCount} 个进入了最终判断。
          </p>
          <div className="mt-4 space-y-3">
            {candidateValidation.validations.map((validation) => (
              <div
                key={validation.factorKey}
                className="rounded-lg border border-[color:var(--line-200)] bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[color:var(--ink-900)]">
                    {validation.factorLabel}
                  </span>
                  <CandidateValidationStatusBadge
                    status={validation.status}
                  />
                </div>
                {validation.validationNote ? (
                  <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
                    {validation.validationNote}
                  </p>
                ) : null}
                {validation.evidence.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs leading-5 text-[color:var(--ink-500)]">
                    {validation.evidence.slice(0, 2).map((item, index) => (
                      <li key={index}>• {item}</li>
                    ))}
                  </ul>
                ) : null}
                {validation.includedInFinalConclusion ? (
                  <p className="mt-3 text-xs font-medium text-emerald-700">
                    已纳入最终判断
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 渲染异常（fail-loud 诊断） */}
      {renderErrors.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-rose-700">
            渲染异常（{renderErrors.length} 个）
          </h4>
          <div className="mt-2 space-y-2">
            {renderErrors.map((block, index) => (
              <div
                key={`render-error-${index}`}
                className="rounded-lg border border-rose-200 bg-rose-50 p-3"
              >
                <p className="text-xs font-medium text-rose-900">
                  Block 类型：{String(block.payload.originalBlockType ?? 'unknown')}
                </p>
                <p className="mt-1 text-xs text-rose-700">
                  {String(block.payload.errorMessage ?? '未知错误')}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 执行时间线 */}
      {timelineBlocks.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
            核验过程
          </h4>
          <div className="mt-2 space-y-2">
            {timelineBlocks.map((block, index) => (
              <div key={`timeline-${index}`}>
                {registry.render({ renderedBlock: block })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 流程看板 */}
      {processBoardBlocks.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
            流程看板
          </h4>
          <div className="mt-2 space-y-2">
            {processBoardBlocks.map((block, index) => (
              <div key={`process-board-${index}`}>
                {registry.render({ renderedBlock: block })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 其他诊断块 */}
      {otherBlocks.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
            其他核验记录
          </h4>
          <div className="mt-2 space-y-2">
            {otherBlocks.map((block, index) => (
              <div key={`other-${index}`}>
                {registry.render({ renderedBlock: block })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="rounded-lg border border-[color:var(--line-200)] bg-white p-4 text-xs text-[color:var(--ink-600)]">
        <summary className="cursor-pointer font-medium text-[color:var(--ink-900)]">
          技术信息
        </summary>
        <div className="mt-3 space-y-1">
          {executionId ? (
            <p>Execution ID：<span className="font-mono">{executionId}</span></p>
          ) : null}
          <p>事件数：{eventCount}</p>
          <p>最后序号：{lastSequence}</p>
        </div>
      </details>
    </div>
  );
}
