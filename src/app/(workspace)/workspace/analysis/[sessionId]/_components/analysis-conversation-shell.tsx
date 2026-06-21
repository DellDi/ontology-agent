'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { AnalysisConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';
import type { ConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import { AnalysisUserMessage } from './analysis-user-message';
import { AnalysisAssistantMessage } from './analysis-assistant-message';
import { AnalysisDetailDrawer, type DetailDrawerType } from './analysis-detail-drawer';
import { CollapsedTurnSummary } from './analysis-collapsed-turn-summary';

// ---------------------------------------------------------------------------
// 主组件：AnalysisConversationShell
// ---------------------------------------------------------------------------

export type AnalysisConversationShellProps = {
  viewModel: AnalysisConversationViewModel;
  /** 多轮追问线程（当存在 2+ 轮时由父层构建），提供后替代单条 viewModel 渲染 */
  thread?: ConversationThreadViewModel;
  drawerContents: Record<string, ReactNode>;
  children?: ReactNode;
};

export function AnalysisConversationShell({
  viewModel,
  thread,
  drawerContents,
  children,
}: AnalysisConversationShellProps) {
  const [activeDrawer, setActiveDrawer] = useState<DetailDrawerType>(null);
  const activeTurnRef = useRef<HTMLDivElement>(null);

  // 线程 activeTurnId 变化时自动滚动到当前轮次
  useEffect(() => {
    activeTurnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [thread?.activeTurnId]);

  const handleOpenDetail = useCallback((drawer: DetailDrawerType) => {
    setActiveDrawer(drawer);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setActiveDrawer(null);
  }, []);

  const turns = thread?.turns;

  return (
    <>
      <div className="mx-auto w-full max-w-[860px] space-y-6 px-4">
        {turns ? (
          turns.map((turn) => (
            <div
              key={turn.executionId}
              ref={turn.isExpanded ? activeTurnRef : undefined}
            >
              <AnalysisUserMessage
                questionText={turn.viewModel.userMessage.questionText}
                badges={turn.viewModel.userMessage.badges}
              />
              {turn.isExpanded ? (
                <AnalysisAssistantMessage
                  status={turn.viewModel.assistantMessage.status}
                  headline={turn.viewModel.assistantMessage.headline}
                  errorSummary={turn.viewModel.assistantMessage.errorSummary}
                  progressLabel={turn.viewModel.assistantMessage.progressLabel}
                  toolActivities={turn.viewModel.assistantMessage.toolActivities}
                  result={turn.viewModel.assistantMessage.result}
                  diagnostics={turn.viewModel.assistantMessage.diagnostics}
                  primaryAnswer={turn.viewModel.assistantMessage.primaryAnswer}
                  metricCards={turn.viewModel.assistantMessage.metricCards}
                  visualizations={turn.viewModel.assistantMessage.visualizations}
                  toolTimeline={turn.viewModel.assistantMessage.toolTimeline}
                  onOpenDetail={handleOpenDetail}
                />
              ) : (
                <CollapsedTurnSummary viewModel={turn.viewModel} />
              )}
            </div>
          ))
        ) : (
          <>
            {/* 用户消息 */}
            <AnalysisUserMessage
              questionText={viewModel.userMessage.questionText}
              badges={viewModel.userMessage.badges}
            />

            {/* 助手消息 */}
            <AnalysisAssistantMessage
              status={viewModel.assistantMessage.status}
              headline={viewModel.assistantMessage.headline}
              errorSummary={viewModel.assistantMessage.errorSummary}
              progressLabel={viewModel.assistantMessage.progressLabel}
              toolActivities={viewModel.assistantMessage.toolActivities}
              result={viewModel.assistantMessage.result}
              diagnostics={viewModel.assistantMessage.diagnostics}
              primaryAnswer={viewModel.assistantMessage.primaryAnswer}
              metricCards={viewModel.assistantMessage.metricCards}
              visualizations={viewModel.assistantMessage.visualizations}
              toolTimeline={viewModel.assistantMessage.toolTimeline}
              onOpenDetail={handleOpenDetail}
            />
          </>
        )}

        {/* 追问入口（由外部 children 注入） */}
        {children}
      </div>

      {/* 详情抽屉 */}
      {activeDrawer ? (
        <AnalysisDetailDrawer
          drawerType={activeDrawer}
          content={drawerContents[activeDrawer] ?? null}
          onClose={handleCloseDrawer}
        />
      ) : null}
    </>
  );
}
