'use client';

import type { ReactNode } from 'react';

import { WorkbenchSheet } from '@/app/_components/workbench/workbench-sheet';

export type DetailDrawerType =
  | 'execution-log'
  | 'plan'
  | 'context'
  | 'history'
  | 'candidates'
  | 'diagnostics'
  | null;

const DRAWER_LABELS: Record<string, string> = {
  'execution-log': '详细信息',
  plan: '分析计划',
  context: '背景信息',
  history: '历史问答',
  candidates: '可能原因',
  diagnostics: '诊断信息',
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
    <WorkbenchSheet
      open
      onClose={onClose}
      title={DRAWER_LABELS[drawerType] ?? '详情'}
      testId={`analysis-detail-drawer-${drawerType}`}
    >
      {content}
    </WorkbenchSheet>
  );
}
