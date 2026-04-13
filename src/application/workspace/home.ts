import {
  createAnalysisSessionTitle,
  getAnalysisSessionStatusLabel,
  type AnalysisSession,
} from '@/domain/analysis-session/models';
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

export type WorkspaceHomeModel = {
  greeting: string;
  analysisActions: Array<{
    label: string;
    description: string;
    status: 'ready' | 'soon';
  }>;
  historyItems: Array<{
    id: string;
    title: string;
    statusLabel: string;
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
};

export function createWorkspaceHomeModel(
  session: AuthSession,
  historySessions: AnalysisSession[],
  scopedProjects: Pick<ErpProject, 'id' | 'name'>[] = [],
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

  return {
    greeting: `${session.displayName}，从你有权限的范围开始今天的分析`,
    analysisActions: [
      {
        label: '新建分析',
        description: '准备进入下一条故事中的问题输入与分析会话创建。',
        status: hasTargets ? 'ready' : 'soon',
      },
      {
        label: '最近分析',
        description: '快速回看已经创建的分析会话，并延续你自己的问题上下文。',
        status: 'ready',
      },
    ],
    historyItems: historySessions.map((analysisSession) => ({
      id: analysisSession.id,
      title: createAnalysisSessionTitle(analysisSession.questionText),
      statusLabel: getAnalysisSessionStatusLabel(analysisSession.status),
      updatedAtLabel: formatHistoryTimestamp(analysisSession.updatedAt),
      href: `/workspace/analysis/${analysisSession.id}`,
    })),
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
  };
}

function formatHistoryTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
