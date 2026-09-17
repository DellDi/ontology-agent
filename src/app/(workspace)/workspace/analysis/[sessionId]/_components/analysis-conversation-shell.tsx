'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import type { AnalysisConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';
import type { JavaAnalysisSession } from '@/infrastructure/java-backend';
import { AnalysisUserMessage } from './analysis-user-message';
import {
  AnalysisAssistantMessage,
  AssistantAvatar,
} from './analysis-assistant-message';
import { AnalysisThinkingMessage } from './analysis-thinking-message';
import { buildStaticAssistantProps } from './analysis-static-assistant-props';
import {
  AnalysisDetailDrawer,
  type DetailDrawerType,
} from './analysis-detail-drawer';
import { AnalysisChatComposer } from './analysis-chat-composer';
import { AnalysisChatLocator } from './analysis-chat-locator';
import {
  createFollowUpAndExecute,
  executePendingFollowUp,
} from './analysis-send-message';

export type ChatTurnStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RoundConclusionState = NonNullable<
  JavaAnalysisSession['history'][number]['conclusionState']
>;

export type ChatTurn = {
  key: string;
  questionText: string;
  status: ChatTurnStatus;
  /** true 时该轮由 live viewModel 渲染（当前执行轮） */
  live: boolean;
  /** 待执行的新消息轮：无执行事实时由 gate 自动接力 */
  followUpId?: string | null;
  conclusionState?: RoundConclusionState | null;
};

export type AnalysisConversationShellProps = {
  sessionId: string;
  viewModel: AnalysisConversationViewModel | null;
  turns: ChatTurn[];
  turnDrawerContents: Record<
    string,
    Partial<Record<Exclude<DetailDrawerType, null>, ReactNode>>
  >;
  suggestions?: string[];
  /** 首轮尚未提交执行（java-initial autoExecute）时展示准备态 */
  preparingInitial?: boolean;
};

export function AnalysisConversationShell({
  sessionId,
  viewModel,
  turns,
  turnDrawerContents,
  suggestions,
  preparingInitial = false,
}: AnalysisConversationShellProps) {
  const router = useRouter();
  const [activeDrawer, setActiveDrawer] = useState<{
    turnKey: string;
    type: Exclude<DetailDrawerType, null>;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSendTransition] = useTransition();
  // 乐观轮次随 transition 生命周期存在：真实轮次经 RSC 提交后自动回收，
  // 不会残留重影；失败时 transition 结束同样回退。
  const [optimisticQuestion, addOptimisticQuestion] =
    useOptimistic<string | null>(null);
  const sendingRef = useRef(false);
  const lastTurnRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);

  // 运行中自动延展：新事件/新内容到达时，若用户仍停留在接近底部则跟随滚动
  const liveStatus = viewModel?.assistantMessage.status;
  const timelineLength = viewModel?.assistantMessage.toolTimeline.length ?? 0;
  const answerLength = viewModel?.assistantMessage.primaryAnswer.length ?? 0;
  const streamLength = viewModel?.assistantMessage.streamingAnswer.length ?? 0;
  useEffect(() => {
    if (liveStatus !== 'running' && liveStatus !== 'queued' && !isSending) {
      return;
    }
    const distanceToBottom =
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    if (distanceToBottom < 320) {
      bottomSentinelRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [timelineLength, answerLength, streamLength, liveStatus, isSending]);

  const sendMessage = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text || sendingRef.current || isSending) return;
      sendingRef.current = true;
      setSendError(null);
      lastTurnRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
      startSendTransition(async () => {
        addOptimisticQuestion(text);
        try {
          const url = await createFollowUpAndExecute(sessionId, text);
          // 客户端导航：RSC 增量刷新，避免整页重载闪烁与滚动归零；
          // 导航提交随本 transition 结束，乐观轮次届时自动回收
          router.push(url, { scroll: false });
        } catch (error) {
          setSendError(
            error instanceof Error && error.message
              ? error.message
              : '发送失败，请稍后重试。',
          );
        } finally {
          sendingRef.current = false;
        }
      });
    },
    [sessionId, router, isSending, addOptimisticQuestion],
  );

  const openDetail = useCallback(
    (turnKey: string) => (drawer: DetailDrawerType) => {
      if (!drawer) return;
      setActiveDrawer({ turnKey, type: drawer });
    },
    [],
  );

  const sending = isSending || optimisticQuestion !== null;
  const liveBusy =
    liveStatus === 'running' ||
    liveStatus === 'queued' ||
    liveStatus === 'disconnected';
  const composerDisabled =
    preparingInitial || liveBusy || turns.some((turn) => turn.status === 'pending');
  const drawerContent = activeDrawer
    ? (turnDrawerContents[activeDrawer.turnKey]?.[activeDrawer.type] ?? null)
    : null;

  const locatorMarks = turns.map((turn, index) => ({
    key: turn.key,
    label: `第 ${index + 1} 轮对话`,
  }));

  return (
    <div className="relative">
      <AnalysisChatLocator marks={locatorMarks} />

      <div className="mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-[860px] flex-col px-4">
        {/* 消息流：全部轮次连续滚动 */}
        <div className="flex-1 space-y-6 pb-6 pt-2">
          {turns.map((turn, index) => {
            const isLast = index === turns.length - 1;
            const details = turnDrawerContents[turn.key] ?? {};
            const availableDetails = (
              Object.keys(details) as Exclude<DetailDrawerType, null>[]
            ).filter((key) => details[key] != null);
            return (
              <div
                className="space-y-4"
                data-chat-turn={turn.key}
                key={turn.key}
                ref={isLast ? lastTurnRef : undefined}
              >
                <AnalysisUserMessage questionText={turn.questionText} />
                {turn.live && viewModel ? (
                  <AnalysisAssistantMessage
                    availableDetails={availableDetails}
                    diagnostics={viewModel.assistantMessage.diagnostics}
                    errorSummary={viewModel.assistantMessage.errorSummary}
                    headline={viewModel.assistantMessage.headline}
                    metricCards={viewModel.assistantMessage.metricCards}
                    onOpenDetail={openDetail(turn.key)}
                    onSuggestionClick={sendMessage}
                    primaryAnswer={viewModel.assistantMessage.primaryAnswer}
                    progressLabel={viewModel.assistantMessage.progressLabel}
                    result={viewModel.assistantMessage.result}
                    runningSinceIso={
                      viewModel.assistantMessage.runningSinceIso
                    }
                    status={viewModel.assistantMessage.status}
                    streamingAnswer={viewModel.assistantMessage.streamingAnswer}
                    suggestions={isLast ? suggestions : undefined}
                    toolActivities={viewModel.assistantMessage.toolActivities}
                    toolTimeline={viewModel.assistantMessage.toolTimeline}
                    visualizations={viewModel.assistantMessage.visualizations}
                  />
                ) : turn.status === 'completed' || turn.status === 'failed' ? (
                  /* 完成/失败历史轮与 live 轮共用组件树：推送新执行时
                     live→static 仅 props 变化，React reconcile 不重挂载，
                     避免图表闪烁重绘 */
                  <AnalysisAssistantMessage
                    availableDetails={availableDetails}
                    onOpenDetail={openDetail(turn.key)}
                    {...buildStaticAssistantProps(turn)}
                  />
                ) : (
                  <AnalysisThinkingMessage />
                )}
                {/* 待执行新消息轮：进入页面即自动接力执行 */}
                {turn.status === 'pending' && turn.followUpId ? (
                  <PendingFollowUpAutoRun
                    followUpId={turn.followUpId}
                    sessionId={sessionId}
                  />
                ) : null}
              </div>
            );
          })}

          {/* 发送中乐观轮次 */}
          {optimisticQuestion !== null ? (
            <div className="space-y-4" data-testid="chat-sending-turn">
              <AnalysisUserMessage pending questionText={optimisticQuestion} />
              <div className="flex justify-start gap-2.5">
                <AssistantAvatar />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    智能员工
                  </p>
                  <div className="mt-1.5 inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    <span className="text-sm text-muted-foreground">
                      正在思考…
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div ref={bottomSentinelRef} />
        </div>

        {/* 发送失败提示 */}
        {sendError ? (
          <p className="pb-2 text-sm text-destructive" role="alert">
            {sendError}
          </p>
        ) : null}

        {/* 输入框：对话窗口底部，下方无任何内容 */}
        <div className="sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent pb-4 pt-3">
          <AnalysisChatComposer
            disabled={composerDisabled}
            onSend={(question) => void sendMessage(question)}
            sending={sending}
          />
        </div>
      </div>

      {/* 详情抽屉 */}
      {activeDrawer ? (
        <AnalysisDetailDrawer
          content={drawerContent}
          drawerType={activeDrawer.type}
          onClose={() => setActiveDrawer(null)}
        />
      ) : null}
    </div>
  );
}

function PendingFollowUpAutoRun({
  sessionId,
  followUpId,
}: {
  sessionId: string;
  followUpId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // 进入页面即自动完成 重生成(如需) → 执行 → 跳转；sessionStorage 去重防重复提交
  useEffect(() => {
    const dedupKey = `analysis-auto-run:${sessionId}:${followUpId}`;
    try {
      if (window.sessionStorage.getItem(dedupKey) === '1') return;
      window.sessionStorage.setItem(dedupKey, '1');
    } catch {
      // sessionStorage 不可用时仅内存去重
    }
    let cancelled = false;
    executePendingFollowUp(sessionId, followUpId)
      .then((url) => {
        if (!cancelled) router.push(url, { scroll: false });
      })
      .catch((runError: unknown) => {
        if (cancelled) return;
        try {
          window.sessionStorage.removeItem(dedupKey);
        } catch {
          // 忽略清理失败
        }
        setError(
          runError instanceof Error && runError.message
            ? runError.message
            : '启动分析失败，请刷新重试。',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, followUpId, router]);

  if (!error) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
}
