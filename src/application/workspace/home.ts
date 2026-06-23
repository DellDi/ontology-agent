import {
  createAnalysisSessionTitle,
  type AnalysisSession,
} from '@/domain/analysis-session/models';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import {
  SUPPORTED_ANALYSIS_TOPICS,
  UNSUPPORTED_ANALYSIS_AREAS,
} from '@/domain/scope-boundary/policy';
import {
  hasScopedTargets,
  type AuthSession,
} from '@/domain/auth/models';
import { formatScopeSummary } from '@/shared/permissions/format-scope-summary';
import type { ErpProject } from '@/domain/erp-read/models';

export type WorkspaceHomeSnapshotSummary = Pick<
  AnalysisExecutionSnapshot,
  'status' | 'executionId' | 'conclusionState' | 'failurePoint'
>;

export type WorkspaceHomeAction = {
  label: string;
  description: string;
  status: 'ready' | 'soon';
  /** ready 状态下的可点击目标；soon 状态忽略 */
  href?: string;
};

export type WorkspaceHomeMetric = {
  id: string;
  label: string;
  value: string;
  helper?: string;
};

export type WorkspaceHomeDegradedState = {
  /** 一句话向用户解释当前数据可能不是最新 */
  message: string;
  /** 来源（'redis-fallback' | 'stream-fallback' | 'unknown'），用于诊断 */
  source: string;
  /** 最近一次失败时间 ISO */
  occurredAt: string;
};

export type WorkspaceHomeModel = {
  greeting: string;
  analysisActions: WorkspaceHomeAction[];
  metrics: WorkspaceHomeMetric[];
  failedItems: WorkspaceHomeModel['historyItems'];
  historyItems: Array<{
    id: string;
    title: string;
    statusLabel: string;
    statusTone: 'neutral' | 'info' | 'success' | 'error';
    derivedStatus: 'pending' | 'running' | 'completed' | 'failed';
    latestExecutionId?: string;
    summaryMetric?: string;
    failureMessage?: string;
    updatedAtLabel: string;
    href: string;
  }>;
  historyEmptyState:
    | {
        title: string;
        description: string;
      }
    | null;
  scopeSummary: ReturnType<typeof formatScopeSummary>;
  projectScopeSummary: string;
  projectDisplayNames: string[];
  boundaryMessage: string;
  boundaryGuidance: {
    supported: string[];
    unsupported: string[];
    note: string;
  };
  emptyState:
    | {
        title: string;
        description: string;
      }
    | null;
  canCreateAnalysis: boolean;
  /** 数据降级状态：当 Redis/stream fallback 失败时由调用方注入。 */
  degradedState: WorkspaceHomeDegradedState | null;
};

export type DerivedSessionStatus = {
  derivedStatus: 'pending' | 'running' | 'completed' | 'failed';
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'success' | 'error';
  summaryMetric?: string;
  failureMessage?: string;
  latestExecutionId?: string;
};

/**
 * 从执行快照派生首页会话状态。
 * 纯函数：无快照时回退到 pending，有快照时按 JobStatus 映射。
 */
export function deriveSessionStatus(
  snapshot: WorkspaceHomeSnapshotSummary | null,
): DerivedSessionStatus {
  if (!snapshot) {
    return {
      derivedStatus: 'pending',
      statusLabel: '待执行',
      statusTone: 'neutral',
    };
  }

  const topCause = snapshot.conclusionState?.causes?.[0];
  const summaryMetric = topCause
    ? `主因: ${topCause.title}`
    : undefined;

  const failureMessage =
    snapshot.failurePoint?.title ?? undefined;

  switch (snapshot.status) {
    case 'completed':
      return {
        derivedStatus: 'completed',
        statusLabel: '已完成',
        statusTone: 'success',
        summaryMetric,
        latestExecutionId: snapshot.executionId,
      };
    case 'failed':
    case 'dead_letter':
      return {
        derivedStatus: 'failed',
        statusLabel: '失败',
        statusTone: 'error',
        failureMessage,
        latestExecutionId: snapshot.executionId,
      };
    case 'processing':
    case 'queued':
      return {
        derivedStatus: 'running',
        statusLabel: '分析中',
        statusTone: 'info',
        latestExecutionId: snapshot.executionId,
      };
    case 'pending':
    default:
      return {
        derivedStatus: 'pending',
        statusLabel: '待执行',
        statusTone: 'neutral',
        latestExecutionId: snapshot.executionId,
      };
  }
}

export function createWorkspaceHomeModel(
  session: AuthSession,
  historySessions: AnalysisSession[],
  scopedProjects: Pick<ErpProject, 'id' | 'name'>[] = [],
  latestSnapshots: Map<string, WorkspaceHomeSnapshotSummary | null> = new Map(),
  degradedState: WorkspaceHomeDegradedState | null = null,
): WorkspaceHomeModel {
  const scopeSummary = formatScopeSummary(session);
  const hasTargets = hasScopedTargets(session);
  const projectsById = new Map(
    scopedProjects.map((project) => [project.id, project.name]),
  );
  const projectDisplayNames = session.scope.projectIds.map(
    (projectId) => projectsById.get(projectId) ?? projectId,
  );
  const projectScopeSummary =
    projectDisplayNames.length > 0
      ? `已覆盖 ${projectDisplayNames.length} 个项目`
      : '未分配';

  const historyItems = historySessions.map((analysisSession) => {
    const snapshot = latestSnapshots.get(analysisSession.id) ?? null;
    const derived = deriveSessionStatus(snapshot);

    return {
      id: analysisSession.id,
      title: createAnalysisSessionTitle(analysisSession.questionText),
      statusLabel: derived.statusLabel,
      statusTone: derived.statusTone,
      derivedStatus: derived.derivedStatus,
      latestExecutionId: derived.latestExecutionId,
      summaryMetric: derived.summaryMetric,
      failureMessage: derived.failureMessage,
      updatedAtLabel: formatHistoryTimestamp(analysisSession.updatedAt),
      href: `/workspace/analysis/${analysisSession.id}`,
    };
  });

  const failedItems = historyItems.filter(
    (item) => item.derivedStatus === 'failed',
  );
  const runningItems = historyItems.filter(
    (item) => item.derivedStatus === 'running' || item.derivedStatus === 'pending',
  );
  const completedItems = historyItems.filter(
    (item) => item.derivedStatus === 'completed',
  );

  const metrics: WorkspaceHomeMetric[] = [
    {
      id: 'recent-total',
      label: '历史分析',
      value: String(historyItems.length),
      helper: '当前账号可见会话总数',
    },
    {
      id: 'running',
      label: '进行中',
      value: String(runningItems.length),
      helper: runningItems.length > 0 ? '可继续追问或查看' : '当前无进行中分析',
    },
    {
      id: 'failed',
      label: '失败待处理',
      value: String(failedItems.length),
      helper: failedItems.length > 0 ? '建议先排查失败原因' : '当前无失败任务',
    },
    {
      id: 'completed',
      label: '已完成',
      value: String(completedItems.length),
      helper: '可继续追问以下钻',
    },
  ];

  const newAnalysisHref = hasTargets ? '/workspace' : undefined;

  return {
    greeting: `${session.displayName}，从你有权限的范围开始今天的分析`,
    analysisActions: [
      {
        label: '新建分析',
        description: '准备进入下一条故事中的问题输入与分析会话创建。',
        status: hasTargets ? 'ready' : 'soon',
        href: newAnalysisHref,
      },
      {
        label: '最近分析',
        description: '快速回看已经创建的分析会话，并延续你自己的问题上下文。',
        status: 'ready',
        href: '#history',
      },
    ],
    metrics,
    failedItems,
    historyItems,
    historyEmptyState:
      historySessions.length === 0
        ? {
            title: '还没有历史分析会话',
            description: '从上方的新建分析开始第一条问题，系统会在这里保留你的分析入口。',
          }
        : null,
    scopeSummary,
    projectScopeSummary,
    projectDisplayNames,
    boundaryMessage: '当前版本仅支持物业分析',
    boundaryGuidance: {
      supported: [...SUPPORTED_ANALYSIS_TOPICS],
      unsupported: [...UNSUPPORTED_ANALYSIS_AREAS],
      note: '客服系统相关能力不在当前版本范围内，请把问题聚焦在物业经营与服务分析本身。',
    },
    emptyState: hasTargets
      ? null
      : {
          title: '当前会话还没有可直接发起分析的项目范围',
          description: '请联系管理员补充分配项目权限，当前仍可确认组织与角色上下文。',
        },
    canCreateAnalysis: hasTargets,
    degradedState,
  };
}

function formatHistoryTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

const workspaceHomeModule = {
  createWorkspaceHomeModel,
  deriveSessionStatus,
};

export default workspaceHomeModule;
