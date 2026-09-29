/**
 * 结构化调整编辑器：把「我的理解」中的每条查询编辑为 QueryIntent 线格式
 * （与 Java QueryIntentCodec 的 camelCase + 小写枚举契约一致），并生成
 * 提交结构化追问所需的 {id, intent} 列表与中文变更摘要。
 * 全部为纯函数；服务端仍负责最终本体校验，此处只做镜像式客户端校验。
 */

import type { SemanticEditorCatalogObject } from './semantic-understanding';

export type StructuredTimeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type StructuredTimeKind =
  | 'relative'
  | 'calendar'
  | 'to-date'
  | 'absolute'
  | 'all';
export type StructuredCompareMode = 'none' | 'keep' | 'absolute';

export type StructuredFilter = {
  member: string;
  operator: string;
  values: string[];
};

/** 编辑器单条查询的可编辑状态；sourceIntent 保留未触及字段供重建时携带。 */
export type StructuredQueryDraft = {
  id: string;
  label?: string;
  object: string;
  measures: string[];
  dimensions: string[];
  filters: StructuredFilter[];
  timeKind: StructuredTimeKind;
  timeDimension: string | null;
  relativeN: number;
  relativeUnit: StructuredTimeUnit;
  calendarUnit: StructuredTimeUnit;
  calendarOffset: number;
  toDateUnit: Exclude<StructuredTimeUnit, 'day'>;
  absoluteFrom: string;
  absoluteTo: string;
  granularity: StructuredTimeUnit | null;
  compareMode: StructuredCompareMode;
  compareFrom: string;
  compareTo: string;
  limit: number | null;
  sourceIntent: Record<string, unknown>;
};

const RELATIVE_UNIT_LABELS: Record<StructuredTimeUnit, string> = {
  day: '天',
  week: '周',
  month: '个月',
  quarter: '个季度',
  year: '年',
};

const CALENDAR_CURRENT_LABELS: Record<StructuredTimeUnit, string> = {
  day: '今天',
  week: '本周',
  month: '本月',
  quarter: '本季度',
  year: '今年',
};

const CALENDAR_PREVIOUS_LABELS: Record<StructuredTimeUnit, string> = {
  day: '昨天',
  week: '上周',
  month: '上月',
  quarter: '上季度',
  year: '去年',
};

const CALENDAR_UNIT_LABELS: Record<StructuredTimeUnit, string> = {
  day: '日',
  week: '周',
  month: '月',
  quarter: '季度',
  year: '年',
};

const TO_DATE_LABELS: Record<Exclude<StructuredTimeUnit, 'day'>, string> = {
  week: '本周以来',
  month: '本月以来',
  quarter: '本季度以来',
  year: '今年以来',
};

export const STRUCTURED_ADJUSTMENT_MAX_QUERIES = 4;
const QUESTION_MAX = 300;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type RawIntent = Record<string, unknown>;

function asRecord(value: unknown): RawIntent | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawIntent)
    : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asFilters(value: unknown): StructuredFilter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const filter = asRecord(item);
      if (!filter || typeof filter.member !== 'string'
          || typeof filter.operator !== 'string') return null;
      return {
        member: filter.member,
        operator: filter.operator,
        values: asStringList(filter.values),
      };
    })
    .filter((item): item is StructuredFilter => item !== null);
}

function unit(value: unknown, fallback: StructuredTimeUnit): StructuredTimeUnit {
  return value === 'day' || value === 'week' || value === 'month'
    || value === 'quarter' || value === 'year'
    ? value
    : fallback;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** 把已执行意图初始化为编辑器草稿；非法字段回落到可编辑默认值。 */
export function structuredDraftFromIntent(
  id: string,
  intent: RawIntent,
  catalogObject?: SemanticEditorCatalogObject,
  label?: string,
): StructuredQueryDraft {
  const time = asRecord(intent.time);
  const expression = asRecord(time?.expression);
  const kind = expression?.kind;
  const compare = asRecord(intent.compare);
  const compareAbsolute = compare?.kind === 'absolute';
  return {
    id,
    label,
    object: typeof intent.object === 'string'
      ? intent.object
      : (catalogObject?.key ?? ''),
    measures: asStringList(intent.measures),
    dimensions: asStringList(intent.dimensions),
    filters: asFilters(intent.filters),
    timeKind: kind === 'relative' || kind === 'calendar' || kind === 'to-date'
      || kind === 'absolute' || kind === 'all'
      ? kind
      : 'all',
    timeDimension: typeof time?.dimension === 'string'
      ? time.dimension
      : (catalogObject?.defaultTime ?? null),
    relativeN: int(expression?.n) ?? 7,
    relativeUnit: unit(expression?.unit, 'day'),
    calendarUnit: unit(expression?.unit, 'month'),
    calendarOffset: int(expression?.offset) ?? 0,
    toDateUnit: expression?.unit === 'week' || expression?.unit === 'month'
      || expression?.unit === 'quarter' || expression?.unit === 'year'
      ? expression.unit
      : 'month',
    absoluteFrom: typeof expression?.from === 'string' ? expression.from : '',
    absoluteTo: typeof expression?.to === 'string' ? expression.to : '',
    granularity: time?.granularity === 'day' || time?.granularity === 'week'
      || time?.granularity === 'month' || time?.granularity === 'quarter'
      || time?.granularity === 'year'
      ? time.granularity
      : null,
    compareMode: compare ? 'keep' : 'none',
    compareFrom: compareAbsolute && typeof compare?.from === 'string'
      ? compare.from
      : '',
    compareTo: compareAbsolute && typeof compare?.to === 'string'
      ? compare.to
      : '',
    limit: int(intent.limit),
    sourceIntent: intent,
  };
}

/** 与模型输出契约一致的 sourceText 生成表。 */
export function timeExpressionSourceText(draft: {
  kind: StructuredTimeKind;
  unit?: StructuredTimeUnit;
  n?: number;
  offset?: number;
  from?: string;
  to?: string;
}): string {
  switch (draft.kind) {
    case 'relative': {
      const n = draft.n ?? 1;
      const unitKey = draft.unit ?? 'day';
      return `最近${n}${RELATIVE_UNIT_LABELS[unitKey]}`;
    }
    case 'calendar': {
      const unitKey = draft.unit ?? 'month';
      const offset = draft.offset ?? 0;
      if (offset === 0) return CALENDAR_CURRENT_LABELS[unitKey];
      if (offset === -1) return CALENDAR_PREVIOUS_LABELS[unitKey];
      return `往前第${-offset}个自然${CALENDAR_UNIT_LABELS[unitKey]}`;
    }
    case 'to-date': {
      const unitKey = draft.unit && draft.unit !== 'day' ? draft.unit : 'month';
      return TO_DATE_LABELS[unitKey];
    }
    case 'absolute':
      return `${draft.from ?? ''} 至 ${draft.to ?? ''}`;
    case 'all':
      return '全部数据';
  }
}

/** 草稿 → 时间表达式（QueryIntentCodec 线格式）。 */
function buildTimeExpression(draft: StructuredQueryDraft): RawIntent {
  const sourceText = timeExpressionSourceText({
    kind: draft.timeKind,
    unit: draft.timeKind === 'relative'
      ? draft.relativeUnit
      : draft.timeKind === 'calendar'
        ? draft.calendarUnit
        : draft.toDateUnit,
    n: draft.relativeN,
    offset: draft.calendarOffset,
    from: draft.absoluteFrom,
    to: draft.absoluteTo,
  });
  switch (draft.timeKind) {
    case 'relative':
      return {
        sourceText,
        kind: 'relative',
        unit: draft.relativeUnit,
        n: draft.relativeN,
      };
    case 'calendar':
      return {
        sourceText,
        kind: 'calendar',
        unit: draft.calendarUnit,
        offset: draft.calendarOffset,
      };
    case 'to-date':
      return { sourceText, kind: 'to-date', unit: draft.toDateUnit };
    case 'absolute':
      return {
        sourceText,
        kind: 'absolute',
        from: draft.absoluteFrom,
        to: draft.absoluteTo,
      };
    case 'all':
      return { sourceText, kind: 'all' };
  }
}

function orderMemberKept(member: string, draft: StructuredQueryDraft): boolean {
  if (member === 'time') return draft.granularity !== null;
  return draft.measures.includes(member) || draft.dimensions.includes(member);
}

/** 草稿 → 完整 intent：保留未编辑字段，裁剪失效 order 项。 */
export function buildStructuredIntent(draft: StructuredQueryDraft): RawIntent {
  const intent: RawIntent = { ...draft.sourceIntent };
  intent.object = draft.object;
  intent.measures = [...draft.measures];
  intent.dimensions = [...draft.dimensions];
  intent.filters = draft.filters.map((filter) => ({
    member: filter.member,
    operator: filter.operator,
    values: [...filter.values],
  }));

  const time: RawIntent = { expression: buildTimeExpression(draft) };
  if (draft.timeDimension) time.dimension = draft.timeDimension;
  if (draft.granularity) time.granularity = draft.granularity;
  intent.time = time;

  if (draft.compareMode === 'none' || draft.timeKind === 'all') {
    delete intent.compare;
  } else if (draft.compareMode === 'absolute') {
    intent.compare = {
      sourceText: `${draft.compareFrom} 至 ${draft.compareTo}`,
      kind: 'absolute',
      from: draft.compareFrom,
      to: draft.compareTo,
    };
  }

  const sourceOrder = Array.isArray(draft.sourceIntent.order)
    ? draft.sourceIntent.order.filter((item) => {
        const entry = asRecord(item);
        return entry !== null
          && typeof entry.member === 'string'
          && orderMemberKept(entry.member, draft);
      })
    : [];
  intent.order = sourceOrder;

  if (draft.limit != null) {
    intent.limit = draft.limit;
  } else {
    delete intent.limit;
  }
  return intent;
}

/** 客户端镜像校验：与后端规则一致，服务端仍为最终裁决。 */
export function validateStructuredDraft(
  draft: StructuredQueryDraft,
  catalogObject: SemanticEditorCatalogObject | undefined,
): string[] {
  const errors: string[] = [];
  const label = draft.label ?? draft.id;
  if (!draft.object) errors.push(`查询 ${label}：缺少查询对象`);
  if (draft.measures.length < 1) errors.push(`查询 ${label}：至少选择一个指标`);
  if (catalogObject) {
    const catalog = catalogObject;
    const has = (list: { key: string }[], key: string) =>
      list.some((item) => item.key === key);
    for (const key of draft.measures) {
      if (!has(catalog.measures, key)) {
        errors.push(`查询 ${label}：指标 ${key} 不在对象目录中`);
      }
    }
    for (const key of draft.dimensions) {
      if (!has(catalog.dimensions, key)) {
        errors.push(`查询 ${label}：维度 ${key} 不在对象目录中`);
      }
    }
    if (draft.timeDimension && !has(catalog.timeDimensions, draft.timeDimension)) {
      errors.push(`查询 ${label}：时间属性 ${draft.timeDimension} 不在对象目录中`);
    }
  }
  if (draft.timeKind === 'relative'
      && (!Number.isInteger(draft.relativeN)
        || draft.relativeN < 1 || draft.relativeN > 1000)) {
    errors.push(`查询 ${label}：最近 N 取值 1-1000`);
  }
  if (draft.timeKind === 'calendar'
      && (!Number.isInteger(draft.calendarOffset) || draft.calendarOffset > 0)) {
    errors.push(`查询 ${label}：自然周期偏移必须为 ≤0 的整数`);
  }
  if (draft.timeKind === 'absolute') {
    if (!DATE_PATTERN.test(draft.absoluteFrom) || !DATE_PATTERN.test(draft.absoluteTo)) {
      errors.push(`查询 ${label}：指定日期需要 from 与 to`);
    } else if (draft.absoluteFrom > draft.absoluteTo) {
      errors.push(`查询 ${label}：开始日期不能晚于结束日期`);
    }
  }
  if (draft.timeKind === 'all' && draft.compareMode !== 'none') {
    errors.push(`查询 ${label}：全部数据不能与对比区间同用`);
  }
  if (draft.compareMode === 'absolute') {
    if (!DATE_PATTERN.test(draft.compareFrom) || !DATE_PATTERN.test(draft.compareTo)) {
      errors.push(`查询 ${label}：对比区间需要 from 与 to`);
    } else if (draft.compareFrom > draft.compareTo) {
      errors.push(`查询 ${label}：对比区间开始不能晚于结束`);
    }
  }
  if (draft.limit != null
      && (!Number.isInteger(draft.limit) || draft.limit < 1 || draft.limit > 1000)) {
    errors.push(`查询 ${label}：Top N 取值 1-1000`);
  }
  return errors;
}

const ASPECT_LABELS = {
  measures: '指标',
  dimensions: '维度',
  timeDimension: '时间属性',
  time: '时间',
  granularity: '粒度',
  compare: '对比',
  filters: '过滤',
  limit: 'Top N',
} as const;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : item);
}

/** 单条草稿相对原始意图的变更项（中文短标签列表）。 */
export function describeDraftChanges(draft: StructuredQueryDraft): string[] {
  const source = draft.sourceIntent;
  const sourceTime = asRecord(source.time);
  const sourceExpression = asRecord(sourceTime?.expression);
  const changes: string[] = [];
  if (canonical(draft.measures) !== canonical(asStringList(source.measures))) {
    changes.push(ASPECT_LABELS.measures);
  }
  if (canonical(draft.dimensions) !== canonical(asStringList(source.dimensions))) {
    changes.push(ASPECT_LABELS.dimensions);
  }
  const sourceTimeDimension = typeof sourceTime?.dimension === 'string'
    ? sourceTime.dimension
    : null;
  if (draft.timeDimension !== sourceTimeDimension) {
    changes.push(ASPECT_LABELS.timeDimension);
  }
  const nextExpression = buildTimeExpression(draft);
  if (canonical(nextExpression) !== canonical(sourceExpression)) {
    changes.push(`时间「${nextExpression.sourceText}」`);
  }
  if (draft.granularity !== (typeof sourceTime?.granularity === 'string'
    ? sourceTime.granularity
    : null)) {
    changes.push(ASPECT_LABELS.granularity);
  }
  const sourceCompare = asRecord(source.compare);
  const nextCompare = draft.compareMode === 'absolute' && draft.timeKind !== 'all'
    ? { kind: 'absolute', from: draft.compareFrom, to: draft.compareTo }
    : draft.compareMode === 'keep' && draft.timeKind !== 'all'
      ? sourceCompare
      : null;
  if (canonical(nextCompare) !== canonical(sourceCompare)) {
    changes.push(ASPECT_LABELS.compare);
  }
  if (canonical(draft.filters) !== canonical(asFilters(source.filters))) {
    changes.push(ASPECT_LABELS.filters);
  }
  const sourceLimit = int(source.limit);
  if (draft.limit !== sourceLimit) {
    changes.push(ASPECT_LABELS.limit);
  }
  return changes;
}

/** 提交结构化调整的问题文本：`调整理解：` + 每条查询的变更摘要，总长 ≤300。 */
export function structuredAdjustmentQuestion(
  drafts: StructuredQueryDraft[],
): string {
  const parts = drafts.map((draft, index) => {
    const changes = describeDraftChanges(draft);
    const label = draft.label ?? `查询${index + 1}`;
    return changes.length > 0
      ? `${label}：${changes.join('、')}`
      : `${label}：保持不变`;
  });
  const question = `调整理解：${parts.join('；')}`;
  return question.length > QUESTION_MAX
    ? question.slice(0, QUESTION_MAX - 1) + '…'
    : question;
}

/** 编辑器提交载荷：[{id, intent}]，id 与既有查询/新查询一致。 */
export function buildStructuredQueries(
  drafts: StructuredQueryDraft[],
): { id: string; intent: RawIntent }[] {
  return drafts.map((draft) => ({
    id: draft.id,
    intent: buildStructuredIntent(draft),
  }));
}
