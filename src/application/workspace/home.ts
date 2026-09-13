import {
  createAnalysisSessionTitle,
  type AnalysisSession,
} from '@/domain/analysis-session/models';
import type { JobStatus } from '@/domain/job-contract/models';
import {
  SUPPORTED_ANALYSIS_TOPICS,
  UNSUPPORTED_ANALYSIS_AREAS,
} from '@/domain/scope-boundary/policy';
import {
  type AuthIdentity,
} from '@/domain/auth/models';
import { formatScopeSummary } from '@/shared/permissions/format-scope-summary';
import type { ErpProject } from '@/domain/erp-read/models';

export type WorkspaceHomeSnapshotSummary = {
  status: JobStatus;
  executionId: string;
  conclusionState: { causes: { title: string }[] } | null;
  failurePoint: { title: string } | null;
  capabilityBinding?: { domainKey: string; capabilityKey: string } | { source: 'legacy/unknown' };
};

export type WorkspaceHomeSessionSummary = Pick<
  AnalysisSession,
  'id' | 'questionText' | 'updatedAt'
> & {
  savedContext: Record<string, unknown>;
};

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

export type WorkspaceHomeCapability = {
  domainKey: string;
  capabilityKey: string;
  displayName: string;
  available: boolean;
  unavailableReason: string | null;
  exampleQuestion: string;
  resolvedScope: { domainKey: string; schemaVersion: number; values: Record<string, unknown> } | null;
};

export type WorkspaceHomeModel = {
  capabilities: Array<WorkspaceHomeCapability & { scopeDescription: string }>;
  greeting: string;
  analysisActions: WorkspaceHomeAction[];
  metrics: WorkspaceHomeMetric[];
  failedItems: WorkspaceHomeModel['historyItems'];
  historyItems: Array<{
    id: string;
    title: string;
    domainLabel: string;
    statusLabel: string;
    statusTone: 'neutral' | 'info' | 'success' | 'error';
    derivedStatus: 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';
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

/** 首页只筛选已加载且后端授权可见的会话，不请求或推断其他范围。 */
export function filterWorkspaceHistory(
  items: WorkspaceHomeModel['historyItems'],
  status: 'all' | 'running' | 'failed' | 'completed',
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => {
    const matchesStatus = status === 'all'
      || (status === 'running'
        ? item.derivedStatus === 'running' || item.derivedStatus === 'pending'
        : item.derivedStatus === status);
    return matchesStatus && `${item.title} ${item.domainLabel}`.toLocaleLowerCase().includes(search);
  });
}

export type DerivedSessionStatus = {
  derivedStatus: 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'success' | 'error';
  summaryMetric?: string;
  failureMessage?: string;
  latestExecutionId?: string;
};

/**
 * 从执行快照派生首页会话状态。
 * 纯函数：Java 新会话无快照时为 pending；旧执行无 Java 快照时明确标记待迁移。
 */
export function deriveSessionStatus(
  snapshot: WorkspaceHomeSnapshotSummary | null,
  executionContract: unknown = 'java-initial-v1',
): DerivedSessionStatus {
  if (!snapshot) {
    if (executionContract !== 'java-initial-v1') {
      return {
        derivedStatus: 'unavailable',
        statusLabel: '旧执行待迁移',
        statusTone: 'neutral',
        failureMessage: '该会话由旧后端执行，本切片不会自动重跑。',
      };
    }
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
  session: AuthIdentity,
  historySessions: WorkspaceHomeSessionSummary[],
  scopedProjects: Pick<ErpProject, 'id' | 'name'>[] = [],
  latestSnapshots: Map<string, WorkspaceHomeSnapshotSummary | null> = new Map(),
  degradedState: WorkspaceHomeDegradedState | null = null,
  capabilities: WorkspaceHomeCapability[] = [],
): WorkspaceHomeModel {
  const scopeSummary = formatScopeSummary(session);
  const hasTargets = capabilities.some(capability => capability.available);
  const projectsById = new Map(
    scopedProjects.map((project) => [project.id, project.name]),
  );
  const displayProjectIds = [...new Set([
    ...session.scope.projectIds,
    ...(session.scope.areaIds.length > 0
      ? scopedProjects.map((project) => project.id)
      : []),
  ])];
  const projectDisplayNames = displayProjectIds.map(
    (projectId) => projectsById.get(projectId) ?? projectId,
  );
  const projectScopeSummary =
    projectDisplayNames.length > 0
      ? `已覆盖 ${projectDisplayNames.length} 个项目`
      : '未分配';

  const historyItems = historySessions.map((analysisSession) => {
    const snapshot = latestSnapshots.get(analysisSession.id) ?? null;
    const derived = deriveSessionStatus(
      snapshot,
      analysisSession.savedContext._executionContract ?? null,
    );

    return {
      id: analysisSession.id,
      title: createAnalysisSessionTitle(analysisSession.questionText),
      domainLabel: snapshot?.capabilityBinding && 'domainKey' in snapshot.capabilityBinding
        ? ({ property: '物业分析', easyv: 'EasyV 生成质量' }[snapshot.capabilityBinding.domainKey]
          ?? snapshot.capabilityBinding.domainKey)
        : '领域待确认',
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
      helper: '本次加载的可见会话',
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

  const newAnalysisHref = hasTargets ? '#new-analysis' : undefined;

  return {
    capabilities: capabilities.map(capability => {
      const values = capability.resolvedScope?.values;
      const scopeDescription = !capability.available ? capability.unavailableReason!
        : capability.domainKey === 'easyv' ? '仅限当前账号创建的 EasyV 应用与生成任务'
        : capability.domainKey === 'property' && values
          ? `授权项目 ${Array.isArray(values.projectIds) ? values.projectIds.length : 0} 个 · 区域 ${Array.isArray(values.areaIds) ? values.areaIds.length : 0} 个`
          : '以本轮分析的授权范围为准';
      return { ...capability, scopeDescription };
    }),
    greeting: `${session.displayName}，从你有权限的范围开始今天的分析`,
    analysisActions: [
      {
        label: '新建分析',
        description: '描述业务问题，查看分析计划、执行进展与证据结论。',
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
    boundaryMessage: '分析范围以本轮授权与能力绑定为准',
    boundaryGuidance: {
      supported: [...SUPPORTED_ANALYSIS_TOPICS],
      unsupported: [...UNSUPPORTED_ANALYSIS_AREAS],
      note: '此处展示物业项目范围；其他领域的授权范围请查看具体分析的「分析依据」。',
    },
    emptyState: hasTargets
      ? null
      : {
          title: '当前账号没有可发起的分析能力',
          description: '请查看能力范围中的不可用原因，或联系管理员开通分析权限。',
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
  filterWorkspaceHistory,
};

export default workspaceHomeModule;
