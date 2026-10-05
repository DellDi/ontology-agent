'use client';

import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { javaSchemeAssessmentResultSchema } from '@/infrastructure/java-backend/scheme-assessment-contract';
import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';
import { SchemeAssessmentPanel } from './scheme-assessment-panel';
import { renderRenderErrorBlock } from './render-system-blocks';

const payloadSchema = z.strictObject({
  result: javaSchemeAssessmentResultSchema,
  role: z.enum(['primary', 'supporting']).optional(),
});

export function renderSchemeComparisonBlock(input: AnalysisInteractionUiRenderInput) {
  const parsed = payloadSchema.safeParse(input.renderedBlock.payload);
  const sessionId = input.renderedBlock.source.sessionId;
  if (!parsed.success || !sessionId
    || parsed.data.result.selection.executionId !== input.renderedBlock.source.executionId) {
    return renderRenderErrorBlock({ ...input, renderedBlock: { ...input.renderedBlock,
      payload: { originalBlockType: 'scheme-comparison', errorMessage: '方案比较结果与来源执行不一致，无法展示。' } } });
  }
  const result = parsed.data.result;
  return <div className={`${input.className ?? ''} space-y-3`} data-testid="analysis-scheme-comparison">
    <SchemeAssessmentPanel sessionId={sessionId} selection={result.selection} initialResult={result} />
    {input.onObjectSelect ? <Button type="button" variant="outline" size="sm"
      onClick={() => input.onObjectSelect?.(result.selection, `原型区域 · ${result.selection.reference.objectId}`)}>
      选择该区域继续分析
    </Button> : null}
  </div>;
}
