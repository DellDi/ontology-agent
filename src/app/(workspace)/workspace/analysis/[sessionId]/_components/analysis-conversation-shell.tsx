'use client';

import { readAnalysisObjects } from '@/infrastructure/java-backend/object-read-client';
import { javaObjectReadRequestSchema } from '@/infrastructure/java-backend/object-read-contract';
import { sameObjectSelectionScope } from '@/domain/analysis-execution/object-selection';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Database, MessageSquare, PanelRightOpen, X } from 'lucide-react';
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
import { objectSelectionDisplayLabel } from '@/application/object-collection/presentation';
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
import { useQueries } from '@tanstack/react-query';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { collectVisualWorkspace, canvasForSelection, workspaceCanvasKey, type BlockProposalReference } from '@/application/workspace/visual-workspace';
import { blockImprovementStatusLabels, blockImprovementQuery } from '@/infrastructure/java-backend/block-improvement-client';
import { AnalysisWorkspaceContext } from './analysis-workspace-context';
import { AnalysisResultBlockRenderer } from './analysis-result-block-renderer';
import { BlockImprovementPanel } from './renderer/block-improvement-panel';
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
  errorCode?: string | null;
  errorMessage?: string | null;
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
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const editorDirty = useRef(false);
  const panelContainer = useRef<HTMLDivElement>(null);
  const restorePanelButton = useRef<HTMLButtonElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
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
  const [objectChoice, setSelectedObject] = useState<{ selection: AnalysisObjectSelection; label: string; completedKey: string | null } | null | undefined>(() =>
    lastTurn?.objectSelection ? { selection: lastTurn.objectSelection,
      label: objectSelectionDisplayLabel(lastTurn.objectSelectionLabel, lastTurn.objectSelection.reference.objectId), completedKey: latestCompletedKey } : undefined);
  // 尚未显式选择或取消时，首次检查完成后接住整批范围；默认画布只负责展示。
  const selectedObject = objectChoice === undefined
    ? latestCompleted?.objectSelection ? { selection: latestCompleted.objectSelection,
      label: objectSelectionDisplayLabel(latestCompleted.objectSelectionLabel, latestCompleted.objectSelection.reference.objectId), completedKey: latestCompletedKey } : null
    : objectChoice;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [canvasOverride, setCanvasOverride] = useState<{ block: AnalysisRenderedBlock; selection?: AnalysisObjectSelection } | null>(() =>
    lastTurn?.objectSelection?.reference.objectKey.startsWith('easyv-prototype-')
      ? { block: canvasForSelection(sessionId, lastTurn.objectSelection, lastTurn.objectSelectionLabel ?? '当前大屏'), selection: lastTurn.objectSelection } : null);
  const turnViews = turns.map(turn => turn.live && viewModel ? viewModel.assistantMessage : buildStaticAssistantProps(turn, sessionId));
  const screenScope = turns.findLast(turn => turn.objectSelection?.reference.objectKey === 'easyv-prototype-layout')?.objectSelection;
  const workspace = collectVisualWorkspace(turnViews.flatMap(view => view.result?.blocks ?? []),screenScope);
  // 不同查询（名称搜索、精确 ID）只有读回同一正式对象与版本后才合并。
  const canvasQueries = workspace.canvases.map(block => javaObjectReadRequestSchema.safeParse({
    executionId: block.source.executionId, datasetVersionSetId: block.payload.datasetVersionSetId,
    objectKey: block.payload.objectKey, filters: block.payload.filters, drilldownId: block.payload.drilldownId,
    limit: 20, offset: 0,
  }));
  const canvasReads = useQueries({ queries: canvasQueries.map(parsed => ({
    queryKey: ['analysis-object', sessionId, parsed.success ? parsed.data : null],
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!parsed.success) throw new Error('大屏查询缺少有效引用。');
      return readAnalysisObjects(sessionId, parsed.data, signal);
    }, enabled: parsed.success, retry: false, staleTime: 0, gcTime: 0,
  })) });
  const resolvedCanvases = new Map<string, typeof workspace.canvases[number]>();
  workspace.canvases.forEach((block,index) => {
    const result = canvasReads[index].data;
    const row = result?.page.rows.length === 1 && !result.page.hasMore ? result.page.rows[0] : null;
    const key = row ? JSON.stringify([row.reference.objectKey, row.reference.objectId, row.reference.productVersionId, result?.datasetVersionSetId]) : workspaceCanvasKey(block);
    resolvedCanvases.set(key, block);
  });
  const canvases = [...resolvedCanvases.values()];
  const proposalReads = useQueries({ queries: workspace.proposals.map(ref => blockImprovementQuery(sessionId, ref.executionId, ref.invocationId)) });
  const proposalItems = workspace.proposals.map((reference, index) => ({ reference,
    view: proposalReads[index].data, error: proposalReads[index].error?.message }));
  const currentProposalTargets = new Map<string, typeof proposalItems[number]>();
  proposalItems.forEach(item => {
    if (item.view) currentProposalTargets.set(JSON.stringify([item.view.selection.reference.objectKey, item.view.selection.reference.objectId, item.view.selection.reference.productVersionId, item.view.selection.datasetVersionSetId]), item);
  });
  const currentProposals = [...currentProposalTargets.values()];
  const earlierProposals = proposalItems.filter(item => item.view && !currentProposals.includes(item));
  const unresolvedProposals = proposalItems.filter(item => !item.view);
  const latestProposal = proposalItems.findLast(item => item.view)?.view;
  const proposalList = (items: typeof proposalItems) => <div className="divide-y divide-border">{items.map(item => <div key={`${item.reference.executionId}:${item.reference.invocationId}`}>
    {item.view ? <button type="button" className="w-full space-y-1 rounded-sm py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-primary" onClick={() => openWorkspaceProposal(item.reference)}>
      <span className="flex items-start justify-between gap-3 text-sm font-medium"><span>{item.view.title}</span><span className="shrink-0 text-xs text-muted-foreground">{blockImprovementStatusLabels[item.view.status]}</span></span>
      <span className="block text-xs text-muted-foreground">{item.view.applicationName}{turns.some(turn => turn.executionId === item.reference.executionId) ? ` · 第 ${turns.findIndex(turn => turn.executionId === item.reference.executionId) + 1} 轮` : ''}</span>
      <span className="line-clamp-2 text-sm leading-6 text-muted-foreground">{item.view.proposal.textChange ? `${item.view.proposal.textChange.beforeTitle} → ${item.view.proposal.textChange.afterTitle}` : item.view.proposal.changes.map(change => change.reason).join('；') || item.view.proposal.diagnosis.themeFit}</span>
    </button> : <p className={item.error ? 'py-3 text-sm text-destructive' : 'py-3 text-sm text-muted-foreground'} role={item.error ? 'alert' : 'status'}>{item.error ?? '正在读取建议…'}</p>}
  </div>)}</div>;
  const hasStructuredStatistics = Boolean(lastTurn?.understanding?.some(query => query.measures.length));
  const currentCanvas = canvasOverride ?? (!hasStructuredStatistics && canvases.length ? { block: canvases[0] }
    : latestProposal ? { block: canvasForSelection(sessionId, latestProposal.selection, latestProposal.title), selection: latestProposal.selection } : null);
  const hasVisualWorkspace = currentCanvas !== null;
  // 已完成对象轮次沿同一引用更新来源执行；浏览对象不会自动改变追问范围。
  const latestSelection = latestCompleted?.objectSelection;
  const selection = selectedObject && latestSelection
    && latestCompletedKey !== selectedObject.completedKey
    && sameObjectSelectionScope(latestSelection, selectedObject.selection)
      ? latestSelection : selectedObject?.selection ?? null;
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
    (question: string, selectedOverride?: AnalysisObjectSelection) => {
      const text = question.trim();
      if (!text || sendingRef.current || isSending) return;
      sendingRef.current = true;
      setSendError(null);
      setHistoryOpen(true);
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
          const url = target.mode === 'follow-up' || selectedOverride
            ? await createFollowUpAndExecute(sessionId, selectedOverride ? text : target.question, selectedOverride ?? selection)
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

  const selectObject = useCallback((selection: AnalysisObjectSelection, label: string, question?: string) => {
    if (editorDirty.current && !window.confirm('查询调整尚未提交，放弃调整并切换对象？')) return false;
    editorDirty.current = false;
    setEditingTurnKey(null);
    setSelectedObject({ selection, label, completedKey: latestCompletedKey });
    setSidePanel(null);
    if (question) sendMessage(question, selection);
    return true;
  }, [latestCompletedKey, sendMessage]);

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
      if (editorDirty.current && !window.confirm('查询调整尚未提交，放弃调整并查看其他内容？')) return;
      editorDirty.current = false;
      setSidePanel(null);
      setEditingTurnKey(null);
      panelTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPanelCollapsed(false);
      setActiveDrawer({ turnKey, type: drawer });
    },
    [],
  );

  const openSidePanel = useCallback(
    (panel: { title: string; content: ReactNode; testId?: string } | null) => {
      if (editorDirty.current && !window.confirm('查询调整尚未提交，放弃调整并查看其他内容？')) return;
      editorDirty.current = false;
      setActiveDrawer(null);
      setEditingTurnKey(null);
      panelTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPanelCollapsed(false);
      setSidePanel(panel);
    },
    [],
  );

  const showWorkspaceObject = (block: AnalysisRenderedBlock) => {
    if (editorDirty.current && !window.confirm('查询调整尚未提交，放弃调整并切换大屏？')) return;
    editorDirty.current = false;
    setEditingTurnKey(null);
    setCanvasOverride({ block });
    setSelectedObject(null);
    setSidePanel(null);
    setActiveDrawer(null);
    setWorkspaceError(null);
  };
  const openWorkspaceProposal = (reference: BlockProposalReference) => {
    const item = proposalItems.find(item => item.reference.executionId === reference.executionId && item.reference.invocationId === reference.invocationId);
    if (!item?.view) { setWorkspaceError(item?.error ?? '提案正在读取，请稍后再打开。'); return; }
    if (!selectObject(item.view.selection, item.view.title)) return;
    setCanvasOverride({ block: canvasForSelection(sessionId, item.view.selection, item.view.title), selection: item.view.selection });
    openSidePanel({ title: `${item.view.title} · 修改建议`, testId: 'analysis-improvement-context',
      content: <BlockImprovementPanel key={`${reference.executionId}:${reference.invocationId}`} {...reference} expanded /> });
    setWorkspaceError(null);
  };

  const collapsePanel = useCallback(() => {
    setPanelCollapsed(true);
    requestAnimationFrame(() => {
      const trigger = panelTrigger.current;
      if (trigger && trigger !== document.body && trigger.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
      else restorePanelButton.current?.focus({ preventScroll: true });
    });
  }, []);

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
    <AnalysisWorkspaceContext.Provider value={{ active: hasVisualWorkspace, selection: selection, showObject: showWorkspaceObject, openProposal: openWorkspaceProposal, proposals: [...currentProposals, ...unresolvedProposals] }}>
    <div className="fill-viewport relative flex min-h-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">

        {(sidePanel || activeDrawer || editingTurnKey) && panelCollapsed ? (
          <div className="flex justify-end px-4 pt-3">
            <Button ref={restorePanelButton} type="button" variant="ghost" size="sm" onClick={() => {
              setPanelCollapsed(false);
              if (window.matchMedia('(max-width: 1279px)').matches) requestAnimationFrame(() => {
                panelContainer.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
              });
            }} aria-label="展开上下文面板">
              <PanelRightOpen aria-hidden className="size-4" />
              {sidePanel?.title ?? '继续查看上下文'}
            </Button>
          </div>
        ) : null}

        {currentCanvas ? <section className="flex min-h-0 flex-1 flex-col px-4 pt-5 sm:px-6" aria-label="大屏改进工作区" data-testid="analysis-visual-workspace">
          <header className="shrink-0 space-y-3 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-lg font-semibold tracking-tight">大屏工作区</h1>
              {proposalItems.length ? <Button type="button" variant="ghost" size="sm" disabled={proposalReads.some(read => read.isPending)} onClick={() => openSidePanel({ title: '修改建议', content: <div>
                {proposalList([...currentProposals, ...unresolvedProposals])}
                {earlierProposals.length ? <details className="mt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">历史建议 · {earlierProposals.length}</summary>{proposalList(earlierProposals)}</details> : null}
              </div> })}>修改建议 {currentProposals.length || '…'}</Button> : null}
            </div>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">分析任务</summary><p className="mt-2 max-w-3xl leading-6">{lastTurn?.questionText}</p></details>
            {canvases.length ? <nav aria-label="切换工作大屏" className="flex gap-1 overflow-x-auto whitespace-nowrap">
              {canvases.map((block, index) => <Button type="button" key={index} variant={workspaceCanvasKey(currentCanvas.block) === workspaceCanvasKey(block) ? 'secondary' : 'ghost'} size="sm"
                aria-pressed={workspaceCanvasKey(currentCanvas.block) === workspaceCanvasKey(block)} onClick={() => showWorkspaceObject(block)}>{block.title?.replace(/ · 原型版式$/, '') ?? '选择大屏'}</Button>)}
            </nav> : null}
            {['running','queued','disconnected'].includes(turnViews.at(-1)?.status ?? '') ? <p role="status" className="text-sm text-muted-foreground">{viewModel?.assistantMessage.progressLabel ?? viewModel?.assistantMessage.headline ?? '正在分析当前对象…'}</p> : null}
            {turnViews.at(-1)?.status === 'failed' ? <div role="alert" className="text-sm text-destructive">最新一轮分析未完成：{turnViews.at(-1)?.errorSummary ?? '请展开对话记录查看原因。'} <button type="button" className="underline underline-offset-4" onClick={() => setHistoryOpen(true)}>查看本轮详情</button></div> : null}
            {workspaceError ? <p role="alert" className="text-sm text-destructive">{workspaceError}</p> : null}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4 [container-type:size]" data-testid="analysis-canvas-scroll">
            <AnalysisResultBlockRenderer key={JSON.stringify([currentCanvas.block.source.executionId,currentCanvas.block.payload,currentCanvas.selection?.reference])}
              block={currentCanvas.block} embedded focusedObject={currentCanvas.selection} onObjectSelect={selectObject} onOpenSidePanel={openSidePanel} />
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-border py-2">
            <p className="text-xs text-muted-foreground">结构预览 · 非业务实况</p>
            <Button type="button" size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>
              <MessageSquare aria-hidden className="size-4" />{historyOpen ? '收起对话记录' : `对话记录 ${turns.length}`}
            </Button>
          </div>
        </section> : null}
        <div className={`mx-auto flex min-h-0 w-full max-w-[1200px] flex-col px-4 ${hasVisualWorkspace ? 'shrink-0' : 'flex-1'}`}>
        {/* 消息流：全部轮次，Conversation 内嵌滚动 + 自动跟随 */}
        <div className={hasVisualWorkspace ? historyOpen ? 'relative flex h-[30dvh] min-h-0 flex-col border-t border-border' : 'hidden' : 'relative flex min-h-0 flex-1 flex-col'}>
        <AnalysisChatLocator marks={locatorMarks} />
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
                  {turn.objectSelection ? <p className="text-right text-xs text-muted-foreground">针对：{objectSelectionDisplayLabel(turn.objectSelectionLabel, turn.objectSelection.reference.objectId)}</p> : null}
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
                      canvasInWorkspace={hasVisualWorkspace || hasStructuredStatistics}
                      workspaceMode={hasVisualWorkspace}
                      availableDetails={availableDetails}
                      clarification={turn.clarification}
                      diagnostics={viewModel.assistantMessage.diagnostics}
                      errorSummary={viewModel.assistantMessage.errorSummary}
                      errorCode={viewModel.assistantMessage.errorCode}
                      headline={viewModel.assistantMessage.headline}
                      metricCards={viewModel.assistantMessage.metricCards}
                      onClarificationOption={answerClarification(turn)}
                      onEditUnderstanding={
                        canEditUnderstanding
                          ? () => {
                              if (editorDirty.current && editingTurnKey !== turn.key && !window.confirm('查询调整尚未提交，放弃调整并切换轮次？')) return;
                              if (editingTurnKey !== turn.key) editorDirty.current = false;
                              panelTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                              setStructuredError(null);
                              setActiveDrawer(null);
                              setSidePanel(null);
                              setPanelCollapsed(false);
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
                      canvasInWorkspace={hasVisualWorkspace || hasStructuredStatistics}
                      workspaceMode={hasVisualWorkspace}
                      availableDetails={availableDetails}
                      clarification={turn.clarification}
                      onClarificationOption={answerClarification(turn)}
                      onEditUnderstanding={
                        canEditUnderstanding
                          ? () => {
                              if (editorDirty.current && editingTurnKey !== turn.key && !window.confirm('查询调整尚未提交，放弃调整并切换轮次？')) return;
                              if (editingTurnKey !== turn.key) editorDirty.current = false;
                              panelTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                              setStructuredError(null);
                              setActiveDrawer(null);
                              setSidePanel(null);
                              setPanelCollapsed(false);
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
        </div>

        {/* 发送失败提示 */}
        {sendError ? (
          <p className="pb-2 text-sm text-destructive" role="alert">
            {sendError}
          </p>
        ) : null}

        {/* 输入框：对话窗口底部，下方无任何内容 */}
        <div className="mb-4 mt-3 rounded-lg border border-input bg-card px-2 pb-1 pt-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          {selectedObject ? <div className="mb-1 flex min-w-0 items-center gap-2 px-3 py-1 text-xs text-muted-foreground" data-testid="analysis-object-selection">
            <span className="min-w-0 flex-1 break-all">针对：{selectedObject.label}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="取消对象选择" onClick={() => {
              if (editorDirty.current && !window.confirm('查询调整尚未提交，放弃调整并取消对象选择？')) return;
              editorDirty.current = false;
              setEditingTurnKey(null);
              setSelectedObject(null);
              if (hasVisualWorkspace) { setSidePanel(null); setActiveDrawer(null); }
            }}><X className="size-3.5" /></Button>
          </div> : null}
          {!hasCompletedRoot && !submissionError ? (
            <p className="pb-2 text-xs text-muted-foreground">
              {composerDisabled ? '正在分析，完成后可继续追问' : '首轮分析未完成，发送将以新会话重新分析'}
            </p>
          ) : null}
          <AnalysisChatComposer
            compact={hasVisualWorkspace}
            disabled={composerDisabled}
            onSend={(question) => void sendMessage(question)}
            sending={sending}
            status={liveStatus}
          />
        </div>
        </div>
      </div>

      {/* 右侧内联面板：详情 / 支撑材料 / 结构化理解编辑（挤压内容区，非弹窗） */}
      <div ref={panelContainer} className={panelCollapsed ? 'hidden' : 'contents'}>
      {activeDrawer ? (
        <AnalysisDetailDrawer
          content={drawerContent}
          drawerType={activeDrawer.type}
          onClose={collapsePanel}
        />
      ) : null}
      {sidePanel ? (
        <AnalysisSidePanel
          onClose={collapsePanel}
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
            collapsePanel();
          }}
          onDirtyChange={() => { editorDirty.current = true; }}
          onSubmit={submitStructuredAdjustment(editingTurn)}
          resolvedQueries={editingTurn.resolvedQueries ?? []}
          serverError={structuredError}
          submitting={sending}
          understanding={editingTurn.understanding}
        />
      ) : null}
      </div>
    </div>
    </AnalysisWorkspaceContext.Provider>
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
