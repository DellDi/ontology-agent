import type {
  AnalysisExecutionStreamEvent,
  ExecutionRenderBlock,
  ExecutionToolListBlock,
} from '@/domain/analysis-execution/stream-models';

export type AnalysisConclusionEvidence = {
  label: string;
  summary: string;
};

export type RankedConclusionCause = {
  id: string;
  rank: number;
  title: string;
  summary: string;
  confidence: number | null;
  evidence: AnalysisConclusionEvidence[];
};

export type AnalysisConclusionReadModel = {
  causes: RankedConclusionCause[];
  renderBlocks: ExecutionRenderBlock[];
};

function extractEvidence(event: AnalysisExecutionStreamEvent) {
  const evidence: AnalysisConclusionEvidence[] = [];

  for (const block of event.renderBlocks) {
    if (block.type === 'kv-list') {
      evidence.push(
        ...block.items
          .filter(
            (item) =>
              !['当前步骤', '进度', '工具选择策略', '步骤标题', '步骤目标'].includes(
                item.label,
              ),
          )
          .map((item) => ({
            label: item.label,
            summary: item.value,
          })),
      );
    }

    if (block.type === 'tool-list') {
      evidence.push(
        ...(block as ExecutionToolListBlock).items.map((item) => ({
          label: `工具 ${item.toolName}`,
          summary: item.objective,
        })),
      );
    }

    if (block.type === 'markdown') {
      evidence.push({
        label: block.title,
        summary: block.content,
      });
    }

    if (block.type === 'table' && block.rows.length > 0) {
      evidence.push({
        label: block.title,
        summary: block.rows[0]
          .map((cell) => String(cell))
          .filter(Boolean)
          .join(' | '),
      });
    }
  }

  return evidence.slice(0, 4);
}

function extractConclusionMetadata(event: AnalysisExecutionStreamEvent) {
  const metadata =
    event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : null;

  const evidence = Array.isArray(metadata?.conclusionEvidence)
    ? metadata.conclusionEvidence
        .filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof (item as { label?: unknown }).label === 'string' &&
            typeof (item as { summary?: unknown }).summary === 'string',
        )
        .map((item) => ({
          label: (item as { label: string }).label,
          summary: (item as { summary: string }).summary,
        }))
    : [];

  return {
    summary:
      typeof metadata?.conclusionSummary === 'string'
        ? metadata.conclusionSummary
        : null,
    title:
      typeof metadata?.conclusionText === 'string'
        ? metadata.conclusionText
        : null,
    confidence:
      typeof metadata?.conclusionConfidence === 'number'
        ? metadata.conclusionConfidence
        : null,
    evidence,
  };
}

function scoreConclusionEvent(event: AnalysisExecutionStreamEvent) {
  const metadata = extractConclusionMetadata(event);
  let score = 0;

  if (metadata.summary || metadata.title) {
    score += 100;
  }

  if (event.step?.id === 'synthesize-attribution') {
    score += 60;
  }

  if (
    event.step?.id === 'confirm-analysis-scope' ||
    event.step?.id === 'confirm-query-scope'
  ) {
    score -= 40;
  }

  if (event.renderBlocks.some((block) => block.type === 'table')) {
    score += 20;
  }

  if (
    event.renderBlocks.some(
      (block) =>
        block.type === 'markdown' && block.title === '结构化分析摘要',
    )
  ) {
    score += 30;
  }

  return score;
}

export function buildAnalysisConclusionReadModel(
  events: AnalysisExecutionStreamEvent[],
): AnalysisConclusionReadModel {
  const stageResultEvents = events
    .filter(
      (event) =>
        event.kind === 'stage-result' &&
        event.step?.status === 'completed' &&
        event.step.order > 0,
    )
    .sort((left, right) => {
      const scoreDiff = scoreConclusionEvent(right) - scoreConclusionEvent(left);

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return (left.step?.order ?? 0) - (right.step?.order ?? 0);
    });

  const causes = stageResultEvents.map((event, index) => {
    const metadata = extractConclusionMetadata(event);
    const evidence = [...metadata.evidence, ...extractEvidence(event)].slice(0, 4);

    return {
      id: event.step?.id ?? event.id,
      rank: index + 1,
      title: metadata.title ?? event.step?.title ?? `原因 ${index + 1}`,
      summary:
        metadata.summary ??
        event.message ??
        `${event.step?.title ?? `步骤 ${index + 1}`} 对当前归因排序产生了影响。`,
      confidence: metadata.confidence,
      evidence,
    };
  });

  return {
    causes,
    renderBlocks: causes.length
      ? [
          {
            type: 'table',
            title: '原因排序',
            columns: ['排序', '原因', '关键证据'],
            rows: causes.map((cause) => [
              String(cause.rank),
              cause.title,
              cause.evidence[0]?.summary ?? cause.summary,
            ]),
          },
        ]
      : [],
  };
}
