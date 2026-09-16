'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { AnalysisConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';
import type { JavaAnalysisSession } from '@/infrastructure/java-backend';
import { AnalysisUserMessage } from './analysis-user-message';
import {
  AnalysisAssistantMessage,
  AssistantAvatar,
} from './analysis-assistant-message';
import { AnalysisStaticAssistantMessage } from './analysis-static-assistant-message';
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

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending'; question: string }
  | { phase: 'error'; message: string };

export function AnalysisConversationShell({
  sessionId,
  viewModel,
  turns,
  turnDrawerContents,
  suggestions,
  preparingInitial = false,
}: AnalysisConversationShellProps) {
  const [activeDrawer, setActiveDrawer] = useState<{
    turnKey: string;
    type: Exclude<DetailDrawerType, null>;
  } | null>(null);
  const [sendState, setSendState] = useState<SendState>({ phase: 'idle' });
  const sendingRef = useRef(false);
  const lastTurnRef = useRef<HTMLDivElement | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || sendingRef.current) return;
      sendingRef.current = true;
      setSendState({ phase: 'sending', question: text });
      lastTurnRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
      try {
        const url = await createFollowUpAndExecute(sessionId, text);
        window.location.assign(url);
      } catch (error) {
        sendingRef.current = false;
        setSendState({
          phase: 'error',
          message:
            error instanceof Error && error.message
              ? error.message
              : '发送失败，请稍后重试。',
        });
      }
    },
    [sessionId],
  );

  const openDetail = useCallback(
    (turnKey: string) => (drawer: DetailDrawerType) => {
      if (!drawer) return;
      setActiveDrawer({ turnKey, type: drawer });
    },
    [],
  );

  const sending = sendState.phase === 'sending';
  const liveStatus = viewModel?.assistantMessage.status;
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
                    suggestions={isLast ? suggestions : undefined}
                    toolActivities={viewModel.assistantMessage.toolActivities}
                    toolTimeline={viewModel.assistantMessage.toolTimeline}
                    visualizations={viewModel.assistantMessage.visualizations}
                  />
                ) : (
                  <AnalysisStaticAssistantMessage
                    availableDetails={availableDetails}
                    conclusionState={turn.conclusionState ?? null}
                    onOpenDetail={openDetail(turn.key)}
                    status={turn.status}
                  />
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
          {sending ? (
            <div className="space-y-4" data-testid="chat-sending-turn">
              <AnalysisUserMessage pending questionText={sendState.question} />
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
        </div>

        {/* 发送失败提示 */}
        {sendState.phase === 'error' ? (
          <p className="pb-2 text-sm text-destructive" role="alert">
            {sendState.message}
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
        if (!cancelled) window.location.assign(url);
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
  }, [sessionId, followUpId]);

  if (!error) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
}
