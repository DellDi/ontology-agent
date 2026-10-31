'use client';

import { createContext, useContext } from 'react';
import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import type { BlockProposalReference } from '@/application/workspace/visual-workspace';
import type { BlockImprovementView } from '@/infrastructure/java-backend/block-improvement-client';

/** 当前工作区与原 renderer 的连接点；业务引用与动作状态仍来自后端。 */
export const AnalysisWorkspaceContext = createContext<{
  active: boolean;
  selection: AnalysisObjectSelection | null;
  showObject: (block: AnalysisRenderedBlock) => void;
  openProposal: (reference: BlockProposalReference) => void;
  proposals: { reference: BlockProposalReference; view?: BlockImprovementView; error?: string }[];
} | null>(null);

export const useAnalysisWorkspace = () => useContext(AnalysisWorkspaceContext);

export function useActiveAnalysisWorkspace() {
  const workspace = useAnalysisWorkspace();
  return workspace?.active ? workspace : null;
}
