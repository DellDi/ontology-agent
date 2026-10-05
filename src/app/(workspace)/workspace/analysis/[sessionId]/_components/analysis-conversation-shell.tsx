'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Database, X } from 'lucide-react';
import { EmptyState } from '@/app/_components/empty-state';
import { Button } from '@/components/ui/button';
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
import {
  composeClarificationQuestion,
  resolveComposerTarget,
  type ResolvedQueryIntent,
  type SemanticClarification,
  type SemanticEditorCatalog,
  type SemanticQueryUnderstanding,
} from '@/application/analysis-message-projection/semantic-understanding';
import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';
import type { JavaAnalysisSession } from '@/infrastructure/java-backend';
import { AnalysisUserMessage } from './analysis-user-message';
import { AnalysisAssistantMessage } from './analysis-assistant-message';
import { AnalysisThinkingMessage } from './analysis-thinking-message';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { buildStaticAssistantProps } from './analysis-static-assistant-props';
import {
  AnalysisDetailDrawer,
  type DetailDrawerType,
} from './analysis-detail-drawer';
import { AnalysisChatComposer } from './analysis-chat-composer';
import { AnalysisChatLocator } from './analysis-chat-locator';
import { AnalysisSidePanel } from './analysis-side-panel';
import {
  createFollowUpAndExecute,
  createSessionWithQuestion,
  createStructuredFollowUpAndExecute,
  executePendingFollowUp,
} from './analysis-send-message';
import { AnalysisUnderstandingEditor } from './analysis-understanding-editor';

export type ChatTurnStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RoundConclusionState = NonNullable<
  JavaAnalysisSession['history'][number]['conclusionState']
>;

export type ChatTurn = {
  key: string;
  executionId?: string | null;
  /** 根轮次或追问轮次；pending 消息轮一律为 follow-up */
  kind: 'initial' | 'follow-up';
  questionText: string;
  status: ChatTurnStatus;
  /** true 时该轮由 live viewModel 渲染（当前执行轮） */
  live: boolean;
  /** 待执行的新消息轮：无执行事实时由 gate 自动接力 */
  followUpId?: string | null;
  conclusionState?: RoundConclusionState | null;
  /** EasyV 语义计划快照：我的理解 / 编辑目录 / 结构化澄清 / 已执行意图 */
  understanding?: SemanticQueryUnderstanding[] | null;
  editorCatalog?: SemanticEditorCatalog | null;
  clarification?: SemanticClarification | null;
  resolvedQueries?: ResolvedQueryIntent[];
  objectSelection?: AnalysisObjectSelection;
  objectSelectionLabel?: string;
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
  submissionError?: {
    message: string;
    code?: string;
    traceId?: string;
    setupHref?: string;
  };
};

export function AnalysisConversationShell({
  sessionId,
  viewModel,
  turns,
  turnDrawerContents,
  suggestions,
  preparingInitial = false,
  submissionError,
}: AnalysisConversationShellProps) {
  const router = useRouter();
  const [activeDrawer, setActiveDrawer] = useState<{
    turnKey: string;
    type: Exclude<DetailDrawerType, null>;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [editingTurnKey, setEditingTurnKey] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<{
    title: string;
    content: ReactNode;
    testId?: string;
  } | null>(null);
  const lastTurn = turns.at(-1);
  const latestCompleted = turns.findLast((turn) => turn.status === 'completed');
  const latestCompletedKey = latestCompleted?.key ?? null;
  const [selectedObject, setSelectedObject] = useState<{ selection: AnalysisObjectSelection; label: string; completedKey: string | null } | null>(() =>
    lastTurn?.objectSelection ? { selection: lastTurn.objectSelection,
      label: lastTurn.objectSelectionLabel ?? lastTurn.objectSelection.reference.objectId, completedKey: latestCompletedKey } : null);
  // 已完成对象轮次沿同一引用更新来源执行；浏览对象不会自动改变追问范围。
  const latestSelection = latestCompleted?.objectSelection;
  const selection = selectedObject && latestSelection
    && latestCompletedKey !== selectedObject.completedKey
    && latestSelection.datasetVersionSetId === selectedObject.selection.datasetVersionSetId
    && latestSelection.reference.objectKey === selectedObject.selection.reference.objectKey
    && latestSelection.reference.objectId === selectedObject.selection.reference.objectId
    && latestSelection.reference.productVersionId === selectedObject.selection.reference.productVersionId
      ? latestSelection : selectedObject?.selection ?? null;
  const selectObject = useCallback((selection: AnalysisObjectSelection, label: string) => {
    setSelectedObject({ selection, label, completedKey: latestCompletedKey });
    setSidePanel(null);
  }, [latestCompletedKey]);
  const [structuredError, setStructuredError] = useState<string | null>(null);
  const [isSending, startSendTransition] = useTransition();
  // 乐观轮次随 transition 生命周期存在：真实轮次经 RSC 提交后自动回收，
  // 不会残留重影；失败时 transition 结束同样回退。
  const [optimisticQuestion, addOptimisticQuestion] =
    useOptimistic<string | null>(null);
  const sendingRef = useRef(false);
  const lastTurnRef = useRef<HTMLDivElement | null>(null);

  // 自动跟随滚动由 AI Elements Conversation（use-stick-to-bottom）托管：
  // 用户停留在底部附近时新内容自动跟随，向上翻阅后停止跟随，
  // 并出现"回到底部"按钮。
  const liveStatus = viewModel?.assistantMessage.status;

  // 首轮未完成时后端没有可引用的完成态执行：发送改为创建新会话重新分析
  const rootTurn = turns.find((turn) => turn.kind === 'initial') ?? null;
  const hasCompletedRoot = rootTurn?.status === 'completed';

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
          const target = resolveComposerTarget({
            hasCompletedRoot,
            rootQuestion: rootTurn?.questionText ?? null,
            rootClarification: rootTurn?.clarification ?? null,
            text,
          });
          const url = target.mode === 'follow-up'
            ? await createFollowUpAndExecute(sessionId, target.question, selection)
            : await createSessionWithQuestion(target.question);
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
    [sessionId, router, isSending, addOptimisticQuestion, hasCompletedRoot, rootTurn, selection],
  );

  const answerClarification = useCallback(
    (turn: ChatTurn) => (option: string) => {
      const question = composeClarificationQuestion(turn.questionText, option);
      if (turn.kind === 'initial') {
        // 根轮次澄清：以新会话重跑首轮（其 autoExecute 门自动启动执行）
        setSendError(null);
        void createSessionWithQuestion(question)
          .then((url) => router.push(url, { scroll: false }))
          .catch((error: unknown) => {
            setSendError(
              error instanceof Error && error.message
                ? error.message
                : '发送失败，请稍后重试。',
            );
          });
        return;
      }
      sendMessage(question);
    },
    [router, sendMessage],
  );

  const submitStructuredAdjustment = useCallback(
    (turn: ChatTurn) =>
      (payload: {
        question: string;
        queries: { id: string; intent: Record<string, unknown> }[];
      }) => {
        if (sendingRef.current || isSending) return;
        sendingRef.current = true;
        setSendError(null);
        setStructuredError(null);
        lastTurnRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
        startSendTransition(async () => {
          addOptimisticQuestion(payload.question);
          try {
            const url = await createStructuredFollowUpAndExecute(sessionId, {
              question: payload.question,
              parentFollowUpId:
                turn.kind === 'follow-up' ? (turn.followUpId ?? '') : '',
              queries: payload.queries,
              objectSelection: turn.objectSelection ?? null,
            });
            setEditingTurnKey(null);
            router.push(url, { scroll: false });
          } catch (error) {
            // 结构化创建失败（含后端本体校验）展示在抽屉内，轮次不产生乐观残留
            setStructuredError(
              error instanceof Error && error.message
                ? error.message
                : '结构化调整提交失败，请稍后重试。',
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
      setSidePanel(null);
      setEditingTurnKey(null);
      setActiveDrawer({ turnKey, type: drawer });
    },
    [],
  );

  const openSidePanel = useCallback(
    (panel: { title: string; content: ReactNode; testId?: string }) => {
      setActiveDrawer(null);
      setEditingTurnKey(null);
      setSidePanel(panel);
    },
    [],
  );

  const sending = isSending || optimisticQuestion !== null;
  const liveBusy =
    liveStatus === 'running' ||
    liveStatus === 'queued' ||
    liveStatus === 'disconnected';
  const composerDisabled =
    preparingInitial || liveBusy || (!submissionError && turns.some((turn) => turn.status === 'pending'));
  const drawerContent = activeDrawer
    ? (turnDrawerContents[activeDrawer.turnKey]?.[activeDrawer.type] ?? null)
    : null;

  const locatorMarks = turns.map((turn, index) => ({
    key: turn.key,
    label: `第 ${index + 1} 轮对话`,
  }));
  const editingTurn = editingTurnKey
    ? (turns.find((turn) => turn.key === editingTurnKey) ?? null)
    : null;

  return (
    // fill-viewport 标记：通知 WorkspaceShell 本页使用视口固定布局，
    // 侧栏不滚动、内容区锁高，只有消息流在内部滚动。
    // 右侧面板（详情/支撑材料/理解编辑器）为内联挤压式，非弹窗。
    <div className="fill-viewport relative flex min-h-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <AnalysisChatLocator marks={locatorMarks} />

        <div className="mx-auto flex min-h-0 w-full max-w-[860px] flex-1 flex-col px-4">
        {/* 消息流：全部轮次，Conversation 内嵌滚动 + 自动跟随 */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-6 px-0 pb-6 pt-2">
            {turns.map((turn, index) => {
              const isLast = index === turns.length - 1;
              const details = turnDrawerContents[turn.key] ?? {};
              const availableDetails = (
                Object.keys(details) as Exclude<DetailDrawerType, null>[]
              ).filter((key) => details[key] != null);
              const canEditUnderstanding =
                Boolean(turn.editorCatalog)
                && Boolean(turn.resolvedQueries?.length)
                && !composerDisabled
                && !sending;
              return (
                <div
                  className="space-y-4"
                  data-chat-turn={turn.key}
                  key={turn.key}
                  ref={isLast ? lastTurnRef : undefined}
                >
                  <AnalysisUserMessage questionText={turn.questionText} />
                  {turn.objectSelection ? <p className="text-right text-xs text-muted-foreground">针对：{turn.objectSelectionLabel ?? turn.objectSelection.reference.objectId}</p> : null}
                  {turn.kind === 'initial' && submissionError ? (
                    <div role="alert" data-testid="analysis-submission-error" className="space-y-3">
                      <EmptyState
                        icon={<Database aria-hidden="true" />}
                        title="分析暂未就绪"
                        description={submissionError.code === 'ONTOLOGY_NOT_PUBLISHED'
                          ? '当前环境尚未发布分析模型。完成模型发布与数据接入后，即可运行这个问题。'
                          : submissionError.code === 'DATASET_VERSION_SET_NOT_PUBLISHED'
                            ? '当前还没有可供分析的已发布数据。完成数据接入并发布后，即可运行这个问题。'
                            : submissionError.message}
                        action={(
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            {submissionError.setupHref ? (
                              <Button asChild>
                                <Link href={submissionError.setupHref}>
                                  {submissionError.code === 'ONTOLOGY_NOT_PUBLISHED' ? '管理分析模型' : '接入数据'}
                                </Link>
                              </Button>
                            ) : null}
                            <form action={`/api/analysis/sessions/${sessionId}/execute`} method="post">
                              <Button type="submit" variant="outline">重新检查</Button>
                            </form>
                            <Button asChild variant="ghost">
                              <Link href="/workspace">返回工作台</Link>
                            </Button>
                          </div>
                        )}
                      />
                      <p className="text-center text-xs text-muted-foreground">
                        问题已保留，当前未启动分析。{submissionError.setupHref ? '' : '请联系管理员完成初始化。'}
                      </p>
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">查看诊断信息</summary>
                        <div className="mt-2 space-y-1 break-all">
                          <p>{submissionError.message}</p>
                          {submissionError.code ? <p>错误码：{submissionError.code}</p> : null}
                          {submissionError.traceId ? <p>请求编号：{submissionError.traceId}</p> : null}
                        </div>
                      </details>
                    </div>
                  ) : turn.live && viewModel ? (
                    <AnalysisAssistantMessage
                      availableDetails={availableDetails}
                      clarification={turn.clarification}
                      diagnostics={viewModel.assistantMessage.diagnostics}
                      errorSummary={viewModel.assistantMessage.errorSummary}
                      headline={viewModel.assistantMessage.headline}
                      metricCards={viewModel.assistantMessage.metricCards}
                      onClarificationOption={answerClarification(turn)}
                      onEditUnderstanding={
                        canEditUnderstanding
                          ? () => {
                              setStructuredError(null);
                              setActiveDrawer(null);
                              setSidePanel(null);
                              setEditingTurnKey(turn.key);
                            }
                          : undefined
                      }
                      onOpenDetail={openDetail(turn.key)}
                      onOpenSidePanel={openSidePanel}
                      onObjectSelect={selectObject}
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
                      understanding={turn.understanding}
                      visualizations={viewModel.assistantMessage.visualizations}
                    />
                  ) : turn.status === 'completed' || turn.status === 'failed' ? (
                    /* 完成/失败历史轮与 live 轮共用组件树：推送新执行时
                       live→static 仅 props 变化，React reconcile 不重挂载，
                       避免图表闪烁重绘 */
                    <AnalysisAssistantMessage
                      availableDetails={availableDetails}
                      clarification={turn.clarification}
                      onClarificationOption={answerClarification(turn)}
                      onEditUnderstanding={
                        canEditUnderstanding
                          ? () => {
                              setStructuredError(null);
                              setActiveDrawer(null);
                              setSidePanel(null);
                              setEditingTurnKey(turn.key);
                            }
                          : undefined
                      }
                      onOpenDetail={openDetail(turn.key)}
                      onOpenSidePanel={openSidePanel}
                      onObjectSelect={selectObject}
                      understanding={turn.understanding}
                      {...buildStaticAssistantProps(turn, sessionId)}
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
                <AnalysisThinkingMessage />
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* 发送失败提示 */}
        {sendError ? (
          <p className="pb-2 text-sm text-destructive" role="alert">
            {sendError}
          </p>
        ) : null}

        {/* 输入框：对话窗口底部，下方无任何内容 */}
        <div className="pb-4 pt-3">
          {selectedObject ? <div className="mb-2 flex min-w-0 items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs" data-testid="analysis-object-selection">
            <span className="min-w-0 flex-1 break-all">针对：{selectedObject.label}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="取消对象选择" onClick={() => setSelectedObject(null)}><X className="size-3.5" /></Button>
          </div> : null}
          {!hasCompletedRoot && !submissionError ? (
            <p className="pb-2 text-xs text-muted-foreground">
              {composerDisabled ? '正在分析，完成后可继续追问' : '首轮分析未完成，发送将以新会话重新分析'}
            </p>
          ) : null}
          <AnalysisChatComposer
            disabled={composerDisabled}
            onSend={(question) => void sendMessage(question)}
            sending={sending}
            status={liveStatus}
          />
        </div>
        </div>
      </div>

      {/* 右侧内联面板：详情 / 支撑材料 / 结构化理解编辑（挤压内容区，非弹窗） */}
      {activeDrawer ? (
        <AnalysisDetailDrawer
          content={drawerContent}
          drawerType={activeDrawer.type}
          onClose={() => setActiveDrawer(null)}
        />
      ) : null}
      {sidePanel ? (
        <AnalysisSidePanel
          onClose={() => setSidePanel(null)}
          testId={sidePanel.testId}
          title={sidePanel.title}
        >
          {sidePanel.content}
        </AnalysisSidePanel>
      ) : null}
      {editingTurn
      && editingTurn.understanding
      && editingTurn.editorCatalog ? (
        <AnalysisUnderstandingEditor
          catalog={editingTurn.editorCatalog}
          key={editingTurn.key}
          onClose={() => {
            setStructuredError(null);
            setEditingTurnKey(null);
          }}
          onSubmit={submitStructuredAdjustment(editingTurn)}
          resolvedQueries={editingTurn.resolvedQueries ?? []}
          serverError={structuredError}
          submitting={sending}
          understanding={editingTurn.understanding}
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
