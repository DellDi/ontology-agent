'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import {
  getDefaultAnalysisInteractionUiRendererRegistry,
  getToolStatusLabel,
} from './analysis-interaction-ui-renderer-registry';

export { getToolStatusLabel };

type AnalysisInteractionRenderedBlockProps = {
  renderedBlock: AnalysisRenderedBlock;
  className?: string;
};

export function AnalysisInteractionRenderedBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionRenderedBlockProps) {
  return (
    <>
      {getDefaultAnalysisInteractionUiRendererRegistry().render({
        renderedBlock,
        className,
      })}
    </>
  );
}
