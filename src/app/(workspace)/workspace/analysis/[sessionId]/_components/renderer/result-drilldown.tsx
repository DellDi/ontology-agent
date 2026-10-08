'use client';

import { z } from 'zod';
import { javaResultDrilldownSchema } from '@/infrastructure/java-backend/object-read-contract';
import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';
import { renderObjectBrowserBlock } from './render-object-browser';

export type ResultDrilldownActions = ReturnType<typeof resultDrilldownActions>;

/** 只传递服务端绑定 ID；过滤由 Java 从完成快照解析，不在视图里重建。 */
export function resultDrilldownActions(input: AnalysisInteractionUiRenderInput) {
  const { renderedBlock: block, onOpenSidePanel } = input;
  const parsed = z.array(javaResultDrilldownSchema).safeParse(block.payload.drilldowns);
  const bindings = parsed.success ? parsed.data : [];
  const context = block.source.sessionId && block.source.executionId
    && typeof block.payload.datasetVersionSetId === 'string' && block.payload.datasetVersionSetId;
  const has = (row: number, column: number) => !!onOpenSidePanel && !!context && bindings.some(b => b.row === row && b.column === column);
  const open = (row: number, column: number) => {
    const binding = bindings.find(b => b.row === row && b.column === column);
    if (!binding || !onOpenSidePanel || !context) return;
    onOpenSidePanel({ title: '统计项 · 支撑对象', testId: 'analysis-drilldown-drawer',
      content: renderObjectBrowserBlock({ ...input, renderedBlock: {
        ...block, kind: 'object-browser', payload: {
          datasetVersionSetId: block.payload.datasetVersionSetId, objectKey: binding.objectKey,
          drilldownId: binding.id, scopeDescription: binding.scopeDescription,
        },
      } }),
    });
  };
  const reason = block.payload.drilldowns !== undefined && (!parsed.success || !context)
    ? '统计项缺少有效的下钻绑定或执行上下文。'
    : typeof block.payload.drilldownUnavailableReason === 'string' ? block.payload.drilldownUnavailableReason : null;
  return { has, open, reason };
}
