'use client';

import { useEffect, useState } from 'react';

import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import {
  buildLiveConclusionReadModel,
  mergeExecutionEvents,
} from '../analysis-execution-display';
import { AnalysisConclusionPanel } from './analysis-conclusion-panel';
import { AnalysisExecutionStreamPanel } from './analysis-execution-stream-panel';

type AnalysisExecutionLiveShellProps = {
  sessionId: string;
  executionId: string;
  initialReadModel: AnalysisExecutionStreamReadModel;
  initialConclusionReadModel: AnalysisConclusionReadModel | null;
};

const PROCESS_BOARD_STORAGE_KEY = 'analysis-process-board-open-v1';

function resolveExecutionStatus(events: AnalysisExecutionStreamEvent[]) {
  const latestStatusEvent = [...events]
    .reverse()
    .find((event) => event.kind === 'execution-status' && event.status);

  if (latestStatusEvent?.status === 'completed') {
    return {
      label: '已完成',
      tone: 'success' as const,
    };
  }

  if (latestStatusEvent?.status === 'failed') {
    return {
      label: '已失败',
      tone: 'error' as const,
    };
  }

  return {
    label: '执行中',
    tone: 'info' as const,
  };
}

export function AnalysisExecutionLiveShell({
  sessionId,
  executionId,
  initialReadModel,
  initialConclusionReadModel,
}: AnalysisExecutionLiveShellProps) {
  const [events, setEvents] = useState(initialReadModel.events);
  // P1 fix: SSR 与 CSR 首轮渲染必须保持一致，避免 hydration mismatch。
  // localStorage 读取推迟到挂载后的 useEffect 中执行，首轮统一使用 true。
  const [isProcessBoardOpen, setIsProcessBoardOpen] = useState(true);
  const [hasRestoredOpenState, setHasRestoredOpenState] = useState(false);
  const [conclusionReadModel, setConclusionReadModel] = useState(
    buildLiveConclusionReadModel({
      events: initialReadModel.events,
      fallbackReadModel: initialConclusionReadModel,
    }),
  );

  useEffect(() => {
    // 读取 localStorage 必须在挂载后进行，否则 SSR/CSR 初值不一致会导致 hydration mismatch。
    // React 19 的 react-hooks/set-state-in-effect 无法识别"从外部持久化层恢复 UI 状态"这一合法场景，
    // 此处的 one-shot setState 仅会触发一次额外渲染，不构成 cascading renders。
    const persisted = window.localStorage.getItem(PROCESS_BOARD_STORAGE_KEY);
    if (persisted === '0') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsProcessBoardOpen(false);
    }
    setHasRestoredOpenState(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredOpenState) {
      return;
    }

    window.localStorage.setItem(
      PROCESS_BOARD_STORAGE_KEY,
      isProcessBoardOpen ? '1' : '0',
    );
  }, [hasRestoredOpenState, isProcessBoardOpen]);

  // P2 支持：Esc 关闭流程看板，不拦截主画布阅读。
  useEffect(() => {
    if (!isProcessBoardOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProcessBoardOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProcessBoardOpen]);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/analysis/sessions/${sessionId}/stream?executionId=${executionId}`,
    );

    eventSource.onmessage = (message) => {
      const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;

      setEvents((previousEvents) => {
        const nextEvents = mergeExecutionEvents(previousEvents, nextEvent);

        setConclusionReadModel((previousConclusionReadModel) =>
          buildLiveConclusionReadModel({
            events: nextEvents,
            fallbackReadModel:
              previousConclusionReadModel ?? initialConclusionReadModel,
          }),
        );

        return nextEvents;
      });

      if (
        nextEvent.kind === 'execution-status' &&
        (nextEvent.status === 'completed' || nextEvent.status === 'failed')
      ) {
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [executionId, initialConclusionReadModel, sessionId]);

  const executionStatus = resolveExecutionStatus(events);

  return (
    <>
      {conclusionReadModel ? (
        <AnalysisConclusionPanel readModel={conclusionReadModel} />
      ) : null}

      <article className="glass-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
              执行主链
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              自动执行优先
            </h3>
            <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
              当前流程已进入后台异步执行，过程详情可在右侧侧滑看板查看或隐藏。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="rounded-full px-4 py-2 text-sm font-medium"
              data-tone={executionStatus.tone}
              style={{
                backgroundColor:
                  executionStatus.tone === 'success'
                    ? 'rgb(49 185 130 / 14%)'
                    : executionStatus.tone === 'error'
                      ? 'rgb(255 106 106 / 14%)'
                      : 'rgb(234 244 255 / 88%)',
                color:
                  executionStatus.tone === 'success'
                    ? 'rgb(18 96 69)'
                    : executionStatus.tone === 'error'
                      ? 'rgb(159 57 57)'
                      : 'var(--brand-700)',
              }}
            >
              {executionStatus.label}
            </span>
            <button
              className="secondary-button"
              onClick={() => setIsProcessBoardOpen((current) => !current)}
              type="button"
            >
              {isProcessBoardOpen ? '隐藏流程看板' : '显示流程看板'}
            </button>
          </div>
        </div>
      </article>

      <aside
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-[540px] transform transition-transform duration-300 ${isProcessBoardOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="h-full p-2 sm:p-4">
          <div className="flex h-full flex-col overflow-hidden rounded-[30px] border border-[color:var(--line-200)] bg-[color:var(--mist-0)]/97 shadow-[0_26px_58px_rgba(25,38,61,0.22)] backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-[color:var(--line-200)] px-6 py-4">
              <div>
                <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                  Process Board
                </p>
                <p className="mt-1 text-sm text-[color:var(--ink-600)]">
                  执行步骤、状态、工具调用与推理摘要
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={() => setIsProcessBoardOpen(false)}
                type="button"
              >
                收起
              </button>
            </div>
            <AnalysisExecutionStreamPanel events={events} variant="side-sheet" />
          </div>
        </div>
      </aside>

      {/* P2 fix: 移除全屏遮罩 button，避免打开看板时阻断主画布交互；
          符合 UX addendum "切换态：收起/展开不应中断执行流" 的 AC。
          用户可通过 aside 内的"收起"按钮、头部 toggle 或 Esc 键关闭。 */}
      {!isProcessBoardOpen ? (
        <button
          className="primary-button fixed right-5 bottom-5 z-30"
          onClick={() => setIsProcessBoardOpen(true)}
          type="button"
        >
          打开执行流程看板
        </button>
      ) : null}
    </>
  );
}
