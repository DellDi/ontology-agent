import {
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
  type AnalysisRenderedBlock,
} from '@/application/analysis-interaction';
import type { AnalysisHistoryReadModel } from '@/application/analysis-history/use-cases';
import type {
  AiRuntimeConclusionCardPart,
  AiRuntimeEvidenceCardPart,
  AiRuntimeMessagePart,
  AiRuntimePartKind,
  AiRuntimeProjection,
  AiRuntimeResumeAnchorPart,
  AiRuntimeStatusBannerPart,
} from '@/application/ai-runtime';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';
import {
  isSessionAccessibleInScope,
  normalizeQuestionText,
  type AnalysisSession,
} from '@/domain/analysis-session/models';
import type { AuthSession } from '@/domain/auth/models';
import type { JobStatus } from '@/domain/job-contract/models';

export const MOBILE_ANALYSIS_PROJECTION_VERSION = 1 as const;

export const MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS = [
  'status-banner',
  'evidence-card',
  'conclusion-card',
  'resume-anchor',
] as const satisfies readonly AiRuntimePartKind[];

export const MOBILE_ANALYSIS_ALLOWED_RENDER_BLOCK_KINDS = [
  'evidence-card',
] as const;

export const MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH = 120 as const;

type MobileAnalysisAllowedRuntimePartKind =
  (typeof MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS)[number];

type MobileAnalysisAllowedRenderBlockKind =
  (typeof MOBILE_ANALYSIS_ALLOWED_RENDER_BLOCK_KINDS)[number];

export type MobileAnalysisCurrentConclusion = {
  title: string;
  summary: string;
  confidence: number | null;
};

export type MobileAnalysisKeyEvidence = {
  label: string;
  summary: string;
};

export type MobileAnalysisHistoryContextItem = {
  roundId: string;
  kind: 'initial' | 'follow-up';
  label: string;
  questionText: string;
  status: string;
  conclusionTitle: string | null;
  conclusionSummary: string | null;
  isLatest: boolean;
};

export type MobileAnalysisProjectedStatusBannerPart = {
  id: string;
  kind: 'status-banner';
  sourcePartId: string;
  status: JobStatus;
  label: string;
  tone: AiRuntimeStatusBannerPart['tone'];
  message?: string;
};

export type MobileAnalysisProjectedEvidenceCardPart = {
  id: string;
  kind: 'evidence-card';
  sourcePartId: string;
  sourceEventId: string;
  sequence: number;
  title?: string;
  blocks: AnalysisRenderedBlock[];
  omittedBlockKinds: string[];
};

export type MobileAnalysisProjectedConclusionCardPart = {
  id: string;
  kind: 'conclusion-card';
  sourcePartId: string;
  title: string | null;
  summary: string | null;
  confidence: number | null;
  evidence: MobileAnalysisKeyEvidence[];
};

export type MobileAnalysisProjectedResumeAnchorPart = {
  id: string;
  kind: 'resume-anchor';
  sourcePartId: string;
  sessionId: string;
  executionId: string;
  lastSequence: number;
  status: JobStatus;
  isTerminal: boolean;
};

export type MobileAnalysisProjectedPart =
  | MobileAnalysisProjectedStatusBannerPart
  | MobileAnalysisProjectedEvidenceCardPart
  | MobileAnalysisProjectedConclusionCardPart
  | MobileAnalysisProjectedResumeAnchorPart;

export type MobileAnalysisSummaryProjection = {
  sessionId: string;
  executionId: string;
  status: JobStatus;
  currentConclusion: MobileAnalysisCurrentConclusion | null;
  keyEvidence: MobileAnalysisKeyEvidence[];
  lastUpdatedAt: string;
  minimalHistoryContext: MobileAnalysisHistoryContextItem[];
  parts: MobileAnalysisProjectedPart[];
};

export type MobileAnalysisResumeProjection = {
  sessionId: string;
  executionId: string;
  sourcePartId: string;
  status: JobStatus;
  isTerminal: boolean;
  lastSequence: number;
  lastEventId: string | null;
  latestRoundId: string | null;
  resumeMode: 'continue-stream' | 'terminal-review';
};

export type MobileAnalysisFollowUpProjection = {
  sessionId: string;
  parentFollowUpId: string | null;
  latestRoundId: string | null;
  canSubmitLightweightFollowUp: boolean;
  action: {
    method: 'POST';
    url: string;
  };
  pcWorkspaceUrl: string;
  boundary: {
    maxLength: typeof MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH;
    allowedIntents: string[];
    blockedIntents: string[];
  };
};

export type MobileAnalysisProjection = {
  version: typeof MOBILE_ANALYSIS_PROJECTION_VERSION;
  schemaVersion: number;
  contractVersion: number;
  summaryProjection: MobileAnalysisSummaryProjection;
  resumeProjection: MobileAnalysisResumeProjection;
  followUpProjection: MobileAnalysisFollowUpProjection;
};

export type MobileLightweightFollowUpDecision =
  | {
      allowed: true;
      normalizedQuestionText: string;
    }
  | {
      allowed: false;
      normalizedQuestionText: string;
      message: string;
      pcWorkspaceUrl: string;
    };

export class MobileAnalysisProjectionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobileAnalysisProjectionContractError';
  }
}

export class MobileAnalysisProjectionAccessDeniedError extends Error {
  constructor(message = '会话不存在或无权访问。') {
    super(message);
    this.name = 'MobileAnalysisProjectionAccessDeniedError';
  }
}

function assertMobileProjectionAccess(input: {
  viewer: AuthSession;
  session: AnalysisSession;
}) {
  if (input.session.ownerUserId !== input.viewer.userId) {
    throw new MobileAnalysisProjectionAccessDeniedError();
  }

  if (
    !isSessionAccessibleInScope(input.session, {
      userId: input.viewer.userId,
      scope: input.viewer.scope,
    })
  ) {
    throw new MobileAnalysisProjectionAccessDeniedError();
  }
}

function isAllowedRuntimePartKind(
  kind: AiRuntimePartKind,
): kind is MobileAnalysisAllowedRuntimePartKind {
  return MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS.includes(
    kind as MobileAnalysisAllowedRuntimePartKind,
  );
}

function isAllowedRenderBlockKind(
  kind: string,
): kind is MobileAnalysisAllowedRenderBlockKind {
  return MOBILE_ANALYSIS_ALLOWED_RENDER_BLOCK_KINDS.includes(
    kind as MobileAnalysisAllowedRenderBlockKind,
  );
}

function flattenRuntimeParts(projection: AiRuntimeProjection) {
  return projection.messages.flatMap((message) => message.parts);
}

function getRequiredPart<T extends AiRuntimeMessagePart['kind']>(
  projection: AiRuntimeProjection,
  kind: T,
): Extract<AiRuntimeMessagePart, { kind: T }> {
  const part = flattenRuntimeParts(projection).find(
    (candidate): candidate is Extract<AiRuntimeMessagePart, { kind: T }> =>
      candidate.kind === kind,
  );

  if (!part) {
    throw new MobileAnalysisProjectionContractError(
      `mobile projection requires runtime part kind=${kind}`,
    );
  }

  return part;
}

function maxIsoTimestamp(values: readonly (string | null | undefined)[]) {
  const valid = values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return valid.sort().at(-1) ?? new Date(0).toISOString();
}

function resolveCurrentConclusion(
  projection: AiRuntimeProjection,
): MobileAnalysisCurrentConclusion | null {
  const conclusion = flattenRuntimeParts(projection).find(
    (part): part is AiRuntimeConclusionCardPart => part.kind === 'conclusion-card',
  );
  const cause = conclusion?.readModel.causes[0] ?? null;

  if (!cause) {
    return null;
  }

  return {
    title: cause.title,
    summary: cause.summary,
    confidence: cause.confidence,
  };
}

function resolveKeyEvidence(
  projection: AiRuntimeProjection,
): MobileAnalysisKeyEvidence[] {
  const conclusion = flattenRuntimeParts(projection).find(
    (part): part is AiRuntimeConclusionCardPart => part.kind === 'conclusion-card',
  );
  const cause = conclusion?.readModel.causes[0] ?? null;

  if (cause?.evidence.length) {
    return cause.evidence.slice(0, 2).map((item) => ({
      label: item.label,
      summary: item.summary,
    }));
  }

  const evidencePart = flattenRuntimeParts(projection).find(
    (part): part is AiRuntimeEvidenceCardPart => part.kind === 'evidence-card',
  );
  const evidenceBlock = evidencePart?.blocks.find(
    (block) => block.type === 'evidence-card',
  );

  if (!evidenceBlock || evidenceBlock.type !== 'evidence-card') {
    return [];
  }

  return evidenceBlock.evidence.slice(0, 2).map((item) => ({
    label: item.label,
    summary: item.summary,
  }));
}

function projectEvidenceBlocksForMobile(input: {
  part: AiRuntimeEvidenceCardPart;
  sessionId: string;
  executionId: string;
}) {
  const blocks: AnalysisRenderedBlock[] = [];
  const omittedBlockKinds: string[] = [];

  input.part.blocks.forEach((block, index) => {
    if (!isAllowedRenderBlockKind(block.type)) {
      omittedBlockKinds.push(block.type);
      return;
    }

    const normalized = normalizeExecutionRenderBlock(block, {
      sourceType: 'execution-render-block',
      sessionId: input.sessionId,
      executionId: input.executionId,
      eventId: input.part.sourceEventId,
      sequence: input.part.sequence,
      blockIndex: index,
    });
    blocks.push(renderAnalysisInteractionPart(normalized, { surface: 'mobile' }));
  });

  return { blocks, omittedBlockKinds };
}

function projectRuntimePartForMobile(input: {
  part: AiRuntimeMessagePart;
  projection: AiRuntimeProjection;
}): MobileAnalysisProjectedPart | null {
  if (!isAllowedRuntimePartKind(input.part.kind)) {
    return null;
  }

  switch (input.part.kind) {
    case 'status-banner':
      return {
        id: input.part.id,
        kind: input.part.kind,
        sourcePartId: input.part.id,
        status: input.part.status,
        label: input.part.label,
        tone: input.part.tone,
        message: input.part.message,
      };
    case 'evidence-card': {
      const { blocks, omittedBlockKinds } = projectEvidenceBlocksForMobile({
        part: input.part,
        sessionId: input.projection.sessionId,
        executionId: input.projection.executionId,
      });

      return {
        id: input.part.id,
        kind: input.part.kind,
        sourcePartId: input.part.id,
        sourceEventId: input.part.sourceEventId,
        sequence: input.part.sequence,
        title: input.part.title,
        blocks,
        omittedBlockKinds,
      };
    }
    case 'conclusion-card': {
      const cause = input.part.readModel.causes[0] ?? null;

      return {
        id: input.part.id,
        kind: input.part.kind,
        sourcePartId: input.part.id,
        title: cause?.title ?? null,
        summary: cause?.summary ?? null,
        confidence: cause?.confidence ?? null,
        evidence:
          cause?.evidence.slice(0, 2).map((item) => ({
            label: item.label,
            summary: item.summary,
          })) ?? [],
      };
    }
    case 'resume-anchor':
      return {
        id: input.part.id,
        kind: input.part.kind,
        sourcePartId: input.part.id,
        sessionId: input.part.sessionId,
        executionId: input.part.executionId,
        lastSequence: input.part.lastSequence,
        status: input.part.status,
        isTerminal: input.part.isTerminal,
      };
  }
}

function buildMinimalHistoryContext(
  historyReadModel: AnalysisHistoryReadModel,
): MobileAnalysisHistoryContextItem[] {
  return historyReadModel.rounds.slice(-3).map((round) => ({
    roundId: round.id,
    kind: round.kind,
    label: round.label,
    questionText: round.questionText,
    status: round.status,
    conclusionTitle: round.conclusionTitle,
    conclusionSummary: round.conclusionSummary,
    isLatest: round.isLatest,
  }));
}

function buildFollowUpProjection(input: {
  sessionId: string;
  historyReadModel: AnalysisHistoryReadModel;
  currentConclusion: MobileAnalysisCurrentConclusion | null;
  followUpActionUrl: string;
  pcWorkspaceUrl: string;
}): MobileAnalysisFollowUpProjection {
  const latestRound =
    input.historyReadModel.rounds.find(
      (round) => round.id === input.historyReadModel.latestRoundId,
    ) ??
    input.historyReadModel.rounds.at(-1) ??
    null;

  return {
    sessionId: input.sessionId,
    parentFollowUpId: latestRound?.followUpId ?? null,
    latestRoundId: input.historyReadModel.latestRoundId,
    canSubmitLightweightFollowUp: Boolean(input.currentConclusion),
    action: {
      method: 'POST',
      url: input.followUpActionUrl,
    },
    pcWorkspaceUrl: input.pcWorkspaceUrl,
    boundary: {
      maxLength: MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH,
      allowedIntents: [
        '简短澄清',
        '局部下钻',
        '解释当前证据',
        '补充当前结论的轻量问题',
      ],
      blockedIntents: [
        '编辑或重写分析计划',
        '复杂工具审批',
        '跨会话迁移',
        '批量历史管理',
        '长链路编排',
      ],
    },
  };
}

export function buildMobileAnalysisProjection(input: {
  viewer: AuthSession;
  session: AnalysisSession;
  runtimeProjection: AiRuntimeProjection;
  resumeCursor: AnalysisUiMessageProjectionStreamCursor | null;
  historyReadModel: AnalysisHistoryReadModel;
  pcWorkspaceUrl: string;
  followUpActionUrl: string;
}): MobileAnalysisProjection {
  assertMobileProjectionAccess({
    viewer: input.viewer,
    session: input.session,
  });

  if (input.runtimeProjection.sessionId !== input.session.id) {
    throw new MobileAnalysisProjectionContractError(
      `mobile projection session mismatch: expected=${input.session.id}, actual=${input.runtimeProjection.sessionId}`,
    );
  }

  getRequiredPart(input.runtimeProjection, 'status-banner');
  const resumeAnchor = getRequiredPart(
    input.runtimeProjection,
    'resume-anchor',
  ) as AiRuntimeResumeAnchorPart;
  const currentConclusion = resolveCurrentConclusion(input.runtimeProjection);
  const parts = flattenRuntimeParts(input.runtimeProjection)
    .map((part) =>
      projectRuntimePartForMobile({
        part,
        projection: input.runtimeProjection,
      }),
    )
    .filter((part): part is MobileAnalysisProjectedPart => Boolean(part));
  const lastUpdatedAt = maxIsoTimestamp([
    input.session.updatedAt,
    ...input.runtimeProjection.messages.map((message) => message.updatedAt),
  ]);

  return {
    version: MOBILE_ANALYSIS_PROJECTION_VERSION,
    schemaVersion: input.runtimeProjection.schemaVersion,
    contractVersion: input.runtimeProjection.contractVersion,
    summaryProjection: {
      sessionId: input.runtimeProjection.sessionId,
      executionId: input.runtimeProjection.executionId,
      status: input.runtimeProjection.status,
      currentConclusion,
      keyEvidence: resolveKeyEvidence(input.runtimeProjection),
      lastUpdatedAt,
      minimalHistoryContext: buildMinimalHistoryContext(input.historyReadModel),
      parts,
    },
    resumeProjection: {
      sessionId: resumeAnchor.sessionId,
      executionId: resumeAnchor.executionId,
      sourcePartId: resumeAnchor.id,
      status: resumeAnchor.status,
      isTerminal: resumeAnchor.isTerminal,
      lastSequence:
        input.resumeCursor?.lastSequence ?? input.runtimeProjection.lastSequence,
      lastEventId: input.resumeCursor?.lastEventId ?? null,
      latestRoundId: input.historyReadModel.latestRoundId,
      resumeMode: resumeAnchor.isTerminal ? 'terminal-review' : 'continue-stream',
    },
    followUpProjection: buildFollowUpProjection({
      sessionId: input.session.id,
      historyReadModel: input.historyReadModel,
      currentConclusion,
      followUpActionUrl: input.followUpActionUrl,
      pcWorkspaceUrl: input.pcWorkspaceUrl,
    }),
  };
}

const COMPLEX_MOBILE_FOLLOW_UP_PATTERNS = [
  /重写.*计划/,
  /编辑.*计划/,
  /调整.*分析路径/,
  /重规划/,
  /多步骤/,
  /长链路/,
  /工具/,
  /审批/,
  /批量/,
  /跨会话/,
  /迁移/,
  /历史管理/,
  /深度复盘/,
] as const;

export function evaluateMobileLightweightFollowUp(input: {
  questionText: string;
  pcWorkspaceUrl: string;
}): MobileLightweightFollowUpDecision {
  const normalizedQuestionText = normalizeQuestionText(input.questionText);

  if (!normalizedQuestionText) {
    return {
      allowed: false,
      normalizedQuestionText,
      message: '请输入要继续追问的问题。',
      pcWorkspaceUrl: input.pcWorkspaceUrl,
    };
  }

  if (normalizedQuestionText.length > MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH) {
    return {
      allowed: false,
      normalizedQuestionText,
      message: `移动端轻量追问不能超过 ${MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH} 个字符；请前往 PC 工作台完成复杂问题。`,
      pcWorkspaceUrl: input.pcWorkspaceUrl,
    };
  }

  if (
    COMPLEX_MOBILE_FOLLOW_UP_PATTERNS.some((pattern) =>
      pattern.test(normalizedQuestionText),
    )
  ) {
    return {
      allowed: false,
      normalizedQuestionText,
      message: '这个请求涉及复杂计划编辑、工具态干预或长链路编排，请在 PC 工作台继续。',
      pcWorkspaceUrl: input.pcWorkspaceUrl,
    };
  }

  return {
    allowed: true,
    normalizedQuestionText,
  };
}
