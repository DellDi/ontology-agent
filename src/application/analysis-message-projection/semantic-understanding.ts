/**
 * EasyV 语义查询轮次的展示与编辑模型：
 * `_understanding` → 「我的理解」文案；`_resolvedContext.queries` → 编辑器初始意图；
 * `_clarification` → 失败轮次的结构化澄清选项。
 * 全部为纯函数映射，可独立测试。
 */

export type SemanticMemberRef = { key: string; label: string };

export type SemanticUnderstandingFilter = {
  member: string;
  label: string;
  operator: string;
  values: string[];
};

export type SemanticUnderstandingTime = {
  dimension: string;
  label: string;
  sourceText: string;
  kind: string;
  from: string | null;
  to: string;
  allData: boolean;
  granularity: string | null;
};

export type SemanticUnderstandingCoverage = {
  status: 'full' | 'partial' | 'none';
  dataFrom: string | null;
  dataTo: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type SemanticQueryUnderstanding = {
  id: string;
  label: string;
  object: SemanticMemberRef;
  measures: SemanticMemberRef[];
  dimensions: SemanticMemberRef[];
  filters: SemanticUnderstandingFilter[];
  time: SemanticUnderstandingTime;
  compare: { sourceText: string; from: string; to: string } | null;
  limit: number | null;
  coverage: SemanticUnderstandingCoverage;
};

export type SemanticEditorCatalogObject = {
  key: string;
  label: string;
  defaultTime: string | null;
  measures: SemanticMemberRef[];
  dimensions: SemanticMemberRef[];
  timeDimensions: SemanticMemberRef[];
};

export type SemanticEditorCatalog = { objects: SemanticEditorCatalogObject[] };

export type SemanticClarification = { question: string; options: string[] };

/** `_resolvedContext.queries` 中每条已执行查询保留的规范化意图。 */
export type ResolvedQueryIntent = {
  id: string;
  label?: string;
  intent: Record<string, unknown>;
};

const OPERATOR_LABELS: Record<string, string> = {
  equals: '等于',
  'not-equals': '不等于',
  contains: '包含',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  set: '有值',
  'not-set': '无值',
};

export const GRANULARITY_LABELS: Record<string, string> = {
  day: '日',
  week: '周',
  month: '月',
  quarter: '季度',
  year: '年',
};

export type UnderstandingDescription = {
  subject: string;
  time: string;
  compare: string | null;
  filters: string[];
  limit: string | null;
  coverage: { tone: 'muted' | 'amber' | 'rose'; text: string };
};

function filterOperatorLabel(operator: string): string {
  return OPERATOR_LABELS[operator] ?? operator;
}

/** 单条查询的「我的理解」文案：对象·指标（按维度）+ 时间/对比/过滤/Top N + 覆盖度。 */
export function describeSemanticQuery(
  entry: SemanticQueryUnderstanding,
): UnderstandingDescription {
  const measures = entry.measures.map((item) => item.label).join('、');
  const dimensions = entry.dimensions.map((item) => item.label);
  const subject = `${entry.object.label} · ${measures}`
    + (dimensions.length > 0 ? `（按${dimensions.join('、')}）` : '');

  const granularityLabel = entry.time.granularity
    ? GRANULARITY_LABELS[entry.time.granularity] ?? entry.time.granularity
    : null;
  const time = entry.time.allData
    ? `未指定时间，按截至 ${entry.time.to} 的全部数据`
    : `${entry.time.sourceText} → ${entry.time.from ?? ''} 至 ${entry.time.to}`
      + (granularityLabel ? `（按${granularityLabel}）` : '');

  const compare = entry.compare
    ? `对比：${entry.compare.sourceText}（${entry.compare.from} 至 ${entry.compare.to}）`
    : null;

  const filters = entry.filters.map((filter) => {
    const operator = filterOperatorLabel(filter.operator);
    return filter.values.length > 0
      ? `过滤：${filter.label} ${operator} ${filter.values.join('、')}`
      : `过滤：${filter.label} ${operator}`;
  });

  const limit = entry.limit != null ? `Top ${entry.limit}` : null;

  let coverage: UnderstandingDescription['coverage'];
  if (entry.coverage.status === 'full') {
    coverage = {
      tone: 'muted',
      text: `数据覆盖 ${entry.coverage.dataFrom ?? ''} 至 ${entry.coverage.dataTo ?? ''}`,
    };
  } else if (entry.coverage.status === 'partial') {
    coverage = {
      tone: 'amber',
      text: `所选区间部分超出数据覆盖，实际按 ${entry.coverage.effectiveFrom ?? ''} 至 ${entry.coverage.effectiveTo ?? ''} 回答`,
    };
  } else if (entry.coverage.dataFrom) {
    coverage = {
      tone: 'rose',
      text: `所选时间内无数据（数据覆盖 ${entry.coverage.dataFrom} 至 ${entry.coverage.dataTo ?? ''}）`,
    };
  } else {
    coverage = { tone: 'rose', text: '冻结数据中暂无该对象的记录' };
  }

  return { subject, time, compare, filters, limit, coverage };
}

/** 从 planSnapshot._resolvedContext 提取 {id, intent}，供结构化编辑器按查询 id 初始化。 */
export function resolvedQueryIntents(
  resolvedContext: Record<string, unknown> | null | undefined,
): ResolvedQueryIntent[] {
  const raw = resolvedContext?.queries;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ResolvedQueryIntent | null => {
      if (item === null || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !entry.id.trim()) return null;
      if (entry.intent === null || typeof entry.intent !== 'object'
          || Array.isArray(entry.intent)) return null;
      return {
        id: entry.id,
        label: typeof entry.label === 'string' ? entry.label : undefined,
        intent: entry.intent as Record<string, unknown>,
      };
    })
    .filter((item): item is ResolvedQueryIntent => item !== null);
}

const CLARIFICATION_MAX = 300;

/** 澄清选项追问问题：`{原问题}（补充：{选项}）`，总长 ≤300，超长截断原问题部分。 */
export function composeClarificationQuestion(
  baseQuestion: string,
  option: string,
): string {
  const suffix = `（补充：${option}）`;
  const budget = CLARIFICATION_MAX - suffix.length;
  const base = baseQuestion.trim();
  const trimmed = base.length > budget ? base.slice(0, Math.max(0, budget)) : base;
  return `${trimmed}${suffix}`;
}

/**
 * 输入框发送路由：会话存在完成态根轮次时发送追问；否则以新会话重新分析
 * （根轮次携带澄清时把输入作为补充说明并入新会话问题）。
 */
export function resolveComposerTarget(input: {
  hasCompletedRoot: boolean;
  rootQuestion: string | null;
  rootClarification: SemanticClarification | null;
  text: string;
}): { mode: 'follow-up' | 'new-session'; question: string } {
  if (input.hasCompletedRoot) {
    return { mode: 'follow-up', question: input.text };
  }
  const question =
    input.rootClarification && input.rootQuestion
      ? composeClarificationQuestion(input.rootQuestion, input.text)
      : input.text;
  return { mode: 'new-session', question };
}
