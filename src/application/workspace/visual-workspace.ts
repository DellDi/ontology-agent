import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';

export type BlockProposalReference = { executionId: string; invocationId: string };

export function workspaceCanvasKey(block: AnalysisRenderedBlock) {
  const filters = Array.isArray(block.payload.filters) ? block.payload.filters.map(filter => {
    const value = filter as { member: string; operator: string; values: unknown[] };
    return [value.member, value.operator, [...value.values].sort()];
  }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : [];
  return JSON.stringify([block.payload.objectKey, block.payload.datasetVersionSetId ?? null, filters, block.payload.drilldownId ?? null]);
}

/** 只按正式查询与执行引用汇集工作对象，不按可变的展示标题匹配。 */
export function collectVisualWorkspace(blocks: AnalysisRenderedBlock[], screenScope?: AnalysisObjectSelection) {
  const canvases = new Map<string, AnalysisRenderedBlock>();
  const proposals = new Map<string, BlockProposalReference>();
  for (const block of blocks) {
    if (block.kind === 'object-browser' && block.payload.objectKey === 'easyv-prototype-layout') {
      const key = workspaceCanvasKey(block);
      canvases.set(key, block);
    }
    const ref = block.payload.blockImprovement as Partial<BlockProposalReference> | undefined;
    if (ref && typeof ref.executionId === 'string' && ref.executionId && typeof ref.invocationId === 'string' && ref.invocationId) {
      proposals.set(`${ref.executionId}:${ref.invocationId}`, { executionId: ref.executionId, invocationId: ref.invocationId });
    }
  }
  const ids = screenScope ? [screenScope.reference, ...(screenScope.additionalReferences ?? [])].map(ref => ref.objectId) : null;
  const scopedCanvases = [...canvases.values()].filter(block => !ids || Array.isArray(block.payload.filters)
    && block.payload.filters.some(filter => filter && typeof filter === 'object' && filter.member === 'appId'
      && filter.operator === 'EQUALS' && Array.isArray(filter.values) && filter.values.some((id: unknown) => typeof id === 'string' && ids.includes(id))));
  return { canvases: scopedCanvases, proposals: [...proposals.values()] };
}

/** 使用已有对象读取契约打开目标，目标所属大屏与布局继续由 Java 返回。 */
export function canvasForSelection(sessionId: string, selection: AnalysisObjectSelection, label: string): AnalysisRenderedBlock {
  return { kind: 'object-browser', surface: 'workspace', variant: 'object-browser', title: label, label,
    source: { sourceType: 'conclusion-read-model', sessionId, executionId: selection.executionId },
    payload: { objectKey: selection.reference.objectKey, datasetVersionSetId: selection.datasetVersionSetId,
      filters: [], scopeDescription: '当前选中对象' }, diagnostics: { originalType: 'object-browser' } };
}
