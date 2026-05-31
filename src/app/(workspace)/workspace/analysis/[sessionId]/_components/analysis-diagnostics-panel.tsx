'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';

/**
 * 诊断信息面板 — 展示 timeline、process-board、render errors 和其他诊断块。
 * 用于"诊断信息"抽屉，默认隐藏，不进入主聊天阅读流。
 */
export function AnalysisDiagnosticsPanel({
  timelineBlocks,
  processBoardBlocks,
  renderErrors,
  otherBlocks,
  eventCount,
  lastSequence,
  executionId,
}: {
  timelineBlocks: AnalysisRenderedBlock[];
  processBoardBlocks: AnalysisRenderedBlock[];
  renderErrors: AnalysisRenderedBlock[];
  otherBlocks: AnalysisRenderedBlock[];
  eventCount: number;
  lastSequence: number;
  executionId?: string;
}) {
  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  return (
    <div className="space-y-6">
      {/* 元数据 */}
      <div className="space-y-1 text-xs text-[color:var(--ink-600)]">
        {executionId ? (
          <p>Execution ID：<span className="font-mono">{executionId}</span></p>
        ) : null}
        <p>事件数：{eventCount}</p>
        <p>最后序号：{lastSequence}</p>
      </div>

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
            执行时间线
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
            其他
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
    </div>
  );
}
