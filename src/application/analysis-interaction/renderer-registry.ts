import {
  ANALYSIS_INTERACTION_PART_KINDS,
  InvalidAnalysisInteractionPartError,
  type AnalysisInteractionPart,
  type AnalysisInteractionPartKind,
  type AnalysisInteractionSurface,
  projectAnalysisInteractionPart,
} from './interaction-part-schema';

export type AnalysisRendererMaturity = 'phase-a' | 'phase-b' | 'phase-c';

export type AnalysisRenderedBlock = {
  kind: string;
  surface: AnalysisInteractionSurface;
  title?: string;
  label?: string;
  variant: string;
  source: AnalysisInteractionPart['source'];
  payload: Record<string, unknown>;
  diagnostics: AnalysisInteractionPart['diagnostics'];
};

export type AnalysisRendererContext = {
  surface: AnalysisInteractionSurface;
};

export type AnalysisRendererDescriptor = {
  kind: AnalysisInteractionPartKind | string;
  maturity: AnalysisRendererMaturity;
  supportedSurfaces: AnalysisInteractionSurface[];
  render: (
    part: AnalysisInteractionPart,
    context: AnalysisRendererContext,
  ) => AnalysisRenderedBlock;
  project: (
    part: AnalysisInteractionPart,
    context: AnalysisRendererContext,
  ) => AnalysisInteractionPart;
};

export type AnalysisRendererRegistry = {
  register: (descriptor: AnalysisRendererDescriptor) => void;
  resolve: (kind: string) => AnalysisRendererDescriptor | null;
  render: (
    part: AnalysisInteractionPart,
    context: AnalysisRendererContext,
  ) => AnalysisRenderedBlock;
  project: (
    part: AnalysisInteractionPart,
    context: AnalysisRendererContext,
  ) => AnalysisInteractionPart;
  fallback: (
    part: AnalysisInteractionPart,
    context: AnalysisRendererContext,
    reason: string,
  ) => AnalysisRenderedBlock;
};

function resolveMaturity(kind: string): AnalysisRendererMaturity {
  if (
    kind === 'process-board' ||
    kind === 'status' ||
    kind === 'kv-list' ||
    kind === 'tool-list' ||
    kind === 'markdown' ||
    kind === 'reasoning-summary' ||
    kind === 'table' ||
    kind === 'evidence-card' ||
    kind === 'assumption-card' ||
    kind === 'timeline'
  ) {
    return 'phase-a';
  }

  if (kind === 'chart' || kind === 'graph') {
    return 'phase-b';
  }

  return 'phase-c';
}

function renderBaseBlock(
  part: AnalysisInteractionPart,
  context: AnalysisRendererContext,
): AnalysisRenderedBlock {
  return {
    kind: part.kind,
    surface: context.surface,
    title: part.title,
    label: part.label,
    variant: part.kind,
    source: part.source,
    payload: part.payload,
    diagnostics: part.diagnostics,
  };
}

function createDescriptor(kind: AnalysisInteractionPartKind): AnalysisRendererDescriptor {
  return {
    kind,
    maturity: resolveMaturity(kind),
    supportedSurfaces: kind === 'process-board'
      ? ['workspace']
      : ['workspace', 'mobile'],
    render: renderBaseBlock,
    project: projectAnalysisInteractionPart,
  };
}

export function createAnalysisRendererRegistry(
  descriptors: readonly AnalysisRendererDescriptor[] = [],
): AnalysisRendererRegistry {
  const byKind = new Map<string, AnalysisRendererDescriptor>();

  function fallback(
    part: AnalysisInteractionPart,
    context: AnalysisRendererContext,
    reason: string,
  ): AnalysisRenderedBlock {
    return {
      kind: 'fallback-block',
      surface: context.surface,
      title: '暂不支持的分析块',
      label: part.label ?? part.title,
      variant: 'fallback',
      source: part.source,
      payload: {
        originalKind: part.kind,
        reason,
        diagnostics: part.diagnostics,
      },
      diagnostics: {
        originalType: part.diagnostics.originalType,
        originalSource: part.source,
        notes: [reason],
      },
    };
  }

  const registry: AnalysisRendererRegistry = {
    register(descriptor) {
      byKind.set(descriptor.kind, descriptor);
    },
    resolve(kind) {
      return byKind.get(kind) ?? null;
    },
    render(part, context) {
      const descriptor = byKind.get(part.kind);
      if (!descriptor) {
        return fallback(part, context, `renderer not registered: ${part.kind}`);
      }
      if (!descriptor.supportedSurfaces.includes(context.surface)) {
        return fallback(
          part,
          context,
          `surface not supported: ${context.surface}`,
        );
      }
      if (!part.surfaceHints.supportedSurfaces.includes(context.surface)) {
        return fallback(
          part,
          context,
          `surface not supported by part: ${context.surface}`,
        );
      }

      const projected = descriptor.project(part, context);
      return descriptor.render(projected, context);
    },
    project(part, context) {
      const descriptor = byKind.get(part.kind);
      if (!descriptor) {
        return projectAnalysisInteractionPart(part, context);
      }
      if (!descriptor.supportedSurfaces.includes(context.surface)) {
        throw new InvalidAnalysisInteractionPartError(
          `renderer surface 不支持 ${part.kind} -> ${context.surface} 投影。`,
        );
      }
      if (!part.surfaceHints.supportedSurfaces.includes(context.surface)) {
        throw new InvalidAnalysisInteractionPartError(
          `part surface 不支持 ${part.kind} -> ${context.surface} 投影。`,
        );
      }
      return descriptor.project(part, context);
    },
    fallback,
  };

  for (const descriptor of descriptors) {
    registry.register(descriptor);
  }

  return registry;
}

export function createDefaultAnalysisRendererRegistry() {
  return createAnalysisRendererRegistry(
    ANALYSIS_INTERACTION_PART_KINDS.map((kind) => createDescriptor(kind)),
  );
}

let defaultAnalysisRendererRegistry: AnalysisRendererRegistry | null = null;

export function getDefaultAnalysisRendererRegistry() {
  if (!defaultAnalysisRendererRegistry) {
    defaultAnalysisRendererRegistry = createDefaultAnalysisRendererRegistry();
  }

  return defaultAnalysisRendererRegistry;
}

export function renderAnalysisInteractionPart(
  part: AnalysisInteractionPart,
  context: AnalysisRendererContext,
): AnalysisRenderedBlock {
  return getDefaultAnalysisRendererRegistry().render(part, context);
}
