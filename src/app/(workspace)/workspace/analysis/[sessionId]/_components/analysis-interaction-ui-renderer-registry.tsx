'use client';

import type { ReactNode } from 'react';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { getToolStatusLabel } from './renderer/rendering-utils';
import { renderTableBlock, renderChartBlock, renderGraphBlock } from './renderer/block-sub-renderers';
import { renderProcessBoardBlock } from './renderer/render-process-board-block';
import { renderStatusBlock, renderKvListBlock, renderToolListBlock, renderMarkdownBlock, renderReasoningSummaryBlock } from './renderer/render-simple-blocks';
import { renderEvidenceCardBlock, renderTimelineBlock, renderApprovalStateBlock, renderSkillsStateBlock, renderAssumptionCardBlock } from './renderer/render-structured-blocks';
import { renderFallbackBlock, renderRenderErrorBlock, renderConclusionSummaryBlock } from './renderer/render-system-blocks';

export { getToolStatusLabel } from './renderer/rendering-utils';

export type AnalysisInteractionUiRenderInput = {
  renderedBlock: AnalysisRenderedBlock;
  className?: string;
};

export type AnalysisInteractionUiRendererDescriptor = {
  kind: string;
  render: (input: AnalysisInteractionUiRenderInput) => ReactNode;
};

export type AnalysisInteractionUiRendererRegistry = {
  register: (descriptor: AnalysisInteractionUiRendererDescriptor) => void;
  resolve: (kind: string) => AnalysisInteractionUiRendererDescriptor | null;
  render: (input: AnalysisInteractionUiRenderInput) => ReactNode;
  fallback: (input: AnalysisInteractionUiRenderInput) => ReactNode;
};

export function createAnalysisInteractionUiRendererRegistry(
  descriptors: readonly AnalysisInteractionUiRendererDescriptor[] = [],
): AnalysisInteractionUiRendererRegistry {
  const byKind = new Map<string, AnalysisInteractionUiRendererDescriptor>();

  const registry: AnalysisInteractionUiRendererRegistry = {
    register(nextDescriptor) {
      byKind.set(nextDescriptor.kind, nextDescriptor);
    },
    resolve(kind) {
      return byKind.get(kind) ?? null;
    },
    render(input) {
      const nextDescriptor = byKind.get(input.renderedBlock.kind);
      if (nextDescriptor) {
        return nextDescriptor.render(input);
      }

      return registry.fallback({
        ...input,
        renderedBlock: {
          ...input.renderedBlock,
          kind: 'fallback-block',
          payload: {
            ...input.renderedBlock.payload,
            originalKind: input.renderedBlock.kind,
            reason: 'ui renderer not registered',
          },
        },
      });
    },
    fallback(input) {
      return renderFallbackBlock(input);
    },
  };

  for (const nextDescriptor of descriptors) {
    registry.register(nextDescriptor);
  }

  return registry;
}

export function createDefaultAnalysisInteractionUiRendererRegistry() {
  return createAnalysisInteractionUiRendererRegistry([
    { kind: 'process-board', render: renderProcessBoardBlock },
    { kind: 'status', render: renderStatusBlock },
    { kind: 'kv-list', render: renderKvListBlock },
    { kind: 'tool-list', render: renderToolListBlock },
    { kind: 'markdown', render: renderMarkdownBlock },
    { kind: 'reasoning-summary', render: renderReasoningSummaryBlock },
    { kind: 'table', render: renderTableBlock },
    { kind: 'chart', render: renderChartBlock },
    { kind: 'graph', render: renderGraphBlock },
    { kind: 'evidence-card', render: renderEvidenceCardBlock },
    { kind: 'timeline', render: renderTimelineBlock },
    { kind: 'assumption-card', render: renderAssumptionCardBlock },
    { kind: 'approval-state', render: renderApprovalStateBlock },
    { kind: 'skills-state', render: renderSkillsStateBlock },
    { kind: 'render-error', render: renderRenderErrorBlock },
    { kind: 'conclusion-summary', render: renderConclusionSummaryBlock },
    { kind: 'fallback-block', render: renderFallbackBlock },
  ]);
}

let defaultAnalysisInteractionUiRendererRegistry:
  | AnalysisInteractionUiRendererRegistry
  | null = null;

export function getDefaultAnalysisInteractionUiRendererRegistry() {
  if (!defaultAnalysisInteractionUiRendererRegistry) {
    defaultAnalysisInteractionUiRendererRegistry =
      createDefaultAnalysisInteractionUiRendererRegistry();
  }

  return defaultAnalysisInteractionUiRendererRegistry;
}