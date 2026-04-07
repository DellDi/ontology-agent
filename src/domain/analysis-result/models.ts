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
  confidence: number;
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
        ...block.items.map((item) => ({
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
  }

  return evidence.slice(0, 4);
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
    .sort((left, right) => (left.step?.order ?? 0) - (right.step?.order ?? 0));

  const causes = stageResultEvents.map((event, index) => ({
    id: event.step?.id ?? event.id,
    rank: index + 1,
    title: event.step?.title ?? `原因 ${index + 1}`,
    summary:
      event.message ??
      `${event.step?.title ?? `步骤 ${index + 1}`} 对当前归因排序产生了影响。`,
    confidence: Number((0.86 - index * 0.08).toFixed(2)),
    evidence: extractEvidence(event),
  }));

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
