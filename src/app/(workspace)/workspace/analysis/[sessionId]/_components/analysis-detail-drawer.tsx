'use client';

import type { ReactNode } from 'react';

import { AnalysisSidePanel } from './analysis-side-panel';

export type DetailDrawerType =
  | 'execution-log'
  | 'plan'
  | 'context'
  | 'history'
  | 'candidates'
  | 'diagnostics'
  | 'attribution'
  | 'actions'
  | null;

const DRAWER_LABELS: Record<string, string> = {
  'execution-log': '详细信息',
  plan: '分析计划',
  context: '背景信息',
  history: '历史问答',
  candidates: '可能原因',
  diagnostics: '诊断信息',
  attribution: '归因分析',
  actions: '动作建议',
};

export function AnalysisDetailDrawer({
  drawerType,
  content,
  onClose,
}: {
  drawerType: DetailDrawerType;
  content: ReactNode;
  onClose: () => void;
}) {
  if (!drawerType) return null;
  return (
    <AnalysisSidePanel
      onClose={onClose}
      testId={`analysis-detail-drawer-${drawerType}`}
      title={DRAWER_LABELS[drawerType] ?? '详情'}
    >
      {content}
    </AnalysisSidePanel>
  );
}
