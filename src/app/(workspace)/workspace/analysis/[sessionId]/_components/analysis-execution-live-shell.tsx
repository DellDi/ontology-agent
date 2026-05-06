'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  buildAiRuntimeProjection,
  mergeAnalysisExecutionStreamEvents,
  resolveLiveShellCanonicalEvents,
  type AiRuntimeProjection,
  type AiRuntimeStatusBannerPart,
} from '@/application/ai-runtime';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';
import { AnalysisConclusionPanel } from './analysis-conclusion-panel';
import { AnalysisExecutionStreamPanel } from './analysis-execution-stream-panel';
import { buildAnalysisExecutionStreamUrl } from '../analysis-execution-display';

type AnalysisExecutionLiveShellProps = {
  sessionId: string;
  executionId: string;
  ownerUserId: string;
  initialReadModel: AnalysisExecutionStreamReadModel;
  initialConclusionReadModel: AnalysisConclusionReadModel | null;
  initialProjection?: AiRuntimeProjection | null;
  resumeCursor?: AnalysisUiMessageProjectionStreamCursor | null;
  enableLiveStream?: boolean;
  planAssumptions?: string[];
  ontologyVersionBinding?: OntologyVersionBinding | null;
};

// D2: localStorage key 按 user 命名空间隔离，避免多账户同设备互相干扰；
// 同时保留 v2 版本号，前缀 v1 的旧 key 适时废弃。
const PROCESS_BOARD_STORAGE_KEY_PREFIX = 'analysis-process-board-open-v2';

function buildProcessBoardStorageKey(ownerUserId: string) {
  return `${PROCESS_BOARD_STORAGE_KEY_PREFIX}:${ownerUserId}`;
}

function resolveStatusBanner(projection: AiRuntimeProjection) {
  for (const message of projection.messages) {
    for (const part of message.parts) {
      if (part.kind === 'status-banner') {
        return part as AiRuntimeStatusBannerPart;
      }
    }
  }
  return null;
}

function resolveConclusionReadModel(
  projection: AiRuntimeProjection,
): AnalysisConclusionReadModel | null {
  for (const message of projection.messages) {
    for (const part of message.parts) {
      if (part.kind === 'conclusion-card') {
        return part.readModel;
      }
    }
  }
  return null;
}

export function AnalysisExecutionLiveShell({
  sessionId,
  executionId,
  ownerUserId,
  initialReadModel,
  initialConclusionReadModel,
  initialProjection,
  resumeCursor,
  enableLiveStream = true,
  planAssumptions,
  ontologyVersionBinding,
}: AnalysisExecutionLiveShellProps) {
  // D2: key 在 ownerUserId 下隔离，不再使用全局 key。
  const processBoardStorageKey = buildProcessBoardStorageKey(ownerUserId);
  const [events, setEvents] = useState<AnalysisExecutionStreamEvent[]>(
    initialReadModel.events,
  );
  const [hasReceivedLiveEvents, setHasReceivedLiveEvents] = useState(false);

  // Story 10.1 P0 fix：当父层切换 execution（历史查看 / follow-up 切换等场景）时，
  // 组件实例可能被 React 复用，此时 events state 会残留上一条 execution 的 canonical facts，
  // 导致 projection 派生出错误的 status/timeline/conclusion，污染交互叙事。
  // 使用 React 官方"根据 props 同步重置 state"模式（https://react.dev/reference/react/useState#storing-information-from-previous-renders），
  // 将决策下沉到 application 层的 resolveLiveShellCanonicalEvents 纯函数，方便无 React 环境做回归验证。
  // 备注：只重置 canonical events；UI 偏好（processBoard 展开态）在 session 维度稳定，不随 execution 切换而重置。
  const [trackedExecutionKey, setTrackedExecutionKey] = useState(
    () => `${sessionId}::${executionId}`,
  );
  const canonicalResolution = resolveLiveShellCanonicalEvents({
    sessionId,
    executionId,
    previousTrackingKey: trackedExecutionKey,
    previousEvents: events,
    initialEventsForCurrentExecution: initialReadModel.events,
  });
  if (canonicalResolution.didReset) {
    setTrackedExecutionKey(canonicalResolution.trackingKey);
    setEvents(canonicalResolution.events as AnalysisExecutionStreamEvent[]);
    setHasReceivedLiveEvents(false);
  }

  // D1 + P1 fix: 默认态为收起，严格对齐 UX addendum "主画布优先展示阶段结果与结论叙事"。
  // SSR 与 CSR 首轮渲染都为 false，避免 hydration mismatch；
  // 用户在本会话之前已显式展开过的状态通过 localStorage 在挂载后恢复。
  const [isProcessBoardOpen, setIsProcessBoardOpen] = useState(false);
  const [hasRestoredOpenState, setHasRestoredOpenState] = useState(false);

  // Story 10.1: 交互层只消费 AiRuntimeProjection，不再在组件内手写 conclusion/status 派生逻辑。
  const rebuiltProjection = useMemo(
    () =>
      buildAiRuntimeProjection({
        sessionId,
        executionId,
        events,
        fallbackConclusion: initialConclusionReadModel,
      }),
    [sessionId, executionId, events, initialConclusionReadModel],
  );
  const projection =
    initialProjection && !hasReceivedLiveEvents
      ? initialProjection
      : rebuiltProjection;

  useEffect(() => {
    // 读取 localStorage 必须在挂载后进行，否则 SSR/CSR 初值不一致会导致 hydration mismatch。
    // React 19 的 react-hooks/set-state-in-effect 无法识别"从外部持久化层恢复 UI 状态"这一合法场景，
    // 此处的 one-shot setState 仅会触发一次额外渲染，不构成 cascading renders。
    const persisted = window.localStorage.getItem(processBoardStorageKey);
    // D1: 默认收起；仅当用户显式展开过（persisted === '1'）才恢复为展开。
    if (persisted === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsProcessBoardOpen(true);
    }
    setHasRestoredOpenState(true);
  }, [processBoardStorageKey]);

  useEffect(() => {
    if (!hasRestoredOpenState) {
      return;
    }

    window.localStorage.setItem(
      processBoardStorageKey,
      isProcessBoardOpen ? '1' : '0',
    );
  }, [hasRestoredOpenState, isProcessBoardOpen, processBoardStorageKey]);

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
    if (!enableLiveStream) {
      return;
    }

    const eventSource = new EventSource(
      buildAnalysisExecutionStreamUrl({
        sessionId,
        executionId,
        resumeCursor,
      }),
    );

    eventSource.onmessage = (message) => {
      const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;
      setHasReceivedLiveEvents(true);

      // Story 10.1: 合并交由 runtime layer 的纯函数，不再在组件内手工派生 conclusion。
      // projection 通过 useMemo 从 events 重算，组件只维护 canonical events state。
      setEvents((previousEvents) =>
        mergeAnalysisExecutionStreamEvents(previousEvents, nextEvent, {
          sessionId,
          executionId,
          deduplicateBySequence: true,
        }),
      );

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
  }, [enableLiveStream, executionId, resumeCursor, sessionId]);

  const statusBanner = resolveStatusBanner(projection);
  const executionStatus = {
    label: statusBanner?.label ?? '执行中',
    tone: statusBanner?.tone ?? ('info' as const),
  };
  const conclusionReadModel = resolveConclusionReadModel(projection);

  return (
    <>
      {conclusionReadModel ? (
        <AnalysisConclusionPanel
          readModel={conclusionReadModel}
          ontologyVersionBinding={ontologyVersionBinding}
          planAssumptions={planAssumptions}
        />
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
