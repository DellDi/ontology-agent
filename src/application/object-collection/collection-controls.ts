export type CollectionPropertyType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TIME';
export type CollectionProperty = { key: string; label: string; type: CollectionPropertyType };
export type FilterOperator = 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'SET' | 'NOT_SET';
export type CollectionFilter = { member: string; operator: FilterOperator; values: string[] };
export type CollectionOrder = { member: string; direction: 'ASC' | 'DESC' };
export type CollectionControls = { order: CollectionOrder | null; filters: CollectionFilter[] };
export type OperatorChoice = { operator: FilterOperator; label: string; needsValue: boolean };
export type BuiltFilter = { ok: true; filter: CollectionFilter } | { ok: false; message: string };
export type ControlsAction =
  | { type: 'sort'; order: CollectionOrder | null }
  | { type: 'add'; filter: CollectionFilter }
  | { type: 'remove'; index: number }
  | { type: 'clear' };

export const MAX_USER_FILTERS = 5;
export const EMPTY_CONTROLS: CollectionControls = { order: null, filters: [] };

const OPERATORS: Record<CollectionPropertyType, FilterOperator[]> = {
  STRING: ['CONTAINS', 'EQUALS', 'NOT_EQUALS', 'SET', 'NOT_SET'],
  NUMBER: ['EQUALS', 'GTE', 'LTE', 'SET', 'NOT_SET'],
  TIME: ['GTE', 'LT', 'SET', 'NOT_SET'],
  BOOLEAN: ['EQUALS'],
};

export function operatorLabel(type: CollectionPropertyType | undefined, operator: FilterOperator): string {
  switch (operator) {
    case 'CONTAINS': return '包含';
    case 'EQUALS': return type === 'BOOLEAN' ? '为' : '等于';
    case 'NOT_EQUALS': return '不等于';
    case 'GT': return type === 'TIME' ? '晚于' : '大于';
    case 'GTE': return type === 'TIME' ? '不早于' : '不小于';
    case 'LT': return type === 'TIME' ? '早于' : '小于';
    case 'LTE': return type === 'TIME' ? '不晚于' : '不大于';
    case 'SET': return '有值';
    case 'NOT_SET': return '无值';
  }
}

const needsValue = (operator: FilterOperator) => operator !== 'SET' && operator !== 'NOT_SET';

export function operatorChoices(type: CollectionPropertyType): OperatorChoice[] {
  return OPERATORS[type].map((operator) => ({ operator, label: operatorLabel(type, operator), needsValue: needsValue(operator) }));
}

const fail = (message: string): BuiltFilter => ({ ok: false, message });

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** 按声明的属性类型校验并规范化筛选值；失败返回可展示的原因，不静默修正。 */
export function buildFilter(property: CollectionProperty, operator: FilterOperator, raw: string): BuiltFilter {
  if (!OPERATORS[property.type].includes(operator)) return fail(`${property.label} 不支持“${operatorLabel(property.type, operator)}”。`);
  const member = property.key;
  if (!needsValue(operator)) return { ok: true, filter: { member, operator, values: [] } };
  const text = raw.trim();
  if (!text) return fail('请输入筛选值。');
  switch (property.type) {
    case 'STRING':
      return text.length > 500 ? fail('筛选值不能超过 500 个字符。') : { ok: true, filter: { member, operator, values: [text] } };
    case 'NUMBER':
      return /^-?\d+(\.\d+)?$/.test(text) ? { ok: true, filter: { member, operator, values: [text] } } : fail('请输入十进制数字。');
    case 'BOOLEAN':
      return text === 'true' || text === 'false' ? { ok: true, filter: { member, operator, values: [text] } } : fail('请选择“是”或“否”。');
    case 'TIME':
      return validDate(text) ? { ok: true, filter: { member, operator, values: [`${text}T00:00:00+08:00`] } } : fail('请选择有效日期（按北京时间当日 0 点计算）。');
  }
}

export function describeFilter(filter: CollectionFilter, properties: CollectionProperty[]): string {
  const property = properties.find((item) => item.key === filter.member);
  const head = `${property?.label ?? filter.member} ${operatorLabel(property?.type, filter.operator)}`;
  if (!needsValue(filter.operator)) return head;
  const value = filter.values[0] ?? '';
  if (property?.type === 'BOOLEAN') return `${head} ${value === 'true' ? '是' : '否'}`;
  return `${head} ${property?.type === 'TIME' ? value.slice(0, 10) : value}`;
}

const sameFilter = (a: CollectionFilter, b: CollectionFilter) =>
  a.member === b.member && a.operator === b.operator && a.values.length === b.values.length && a.values.every((value, index) => value === b.values[index]);

/** 状态无变化时返回同一引用，调用方据此决定是否重置分页与选中。 */
export function reduceControls(state: CollectionControls, action: ControlsAction, maxFilters = MAX_USER_FILTERS): CollectionControls {
  switch (action.type) {
    case 'sort': {
      const next = action.order;
      if (next === state.order || (next && state.order && next.member === state.order.member && next.direction === state.order.direction)) return state;
      return { ...state, order: next };
    }
    case 'add':
      if (state.filters.length >= maxFilters || state.filters.some((filter) => sameFilter(filter, action.filter))) return state;
      return { ...state, filters: [...state.filters, action.filter] };
    case 'remove':
      if (action.index < 0 || action.index >= state.filters.length) return state;
      return { ...state, filters: state.filters.filter((_, index) => index !== action.index) };
    case 'clear':
      return state.order === null && state.filters.length === 0 ? state : EMPTY_CONTROLS;
  }
}

/**
 * 把用户控制合并进对象读取请求：对象范围入口在原条件之后追加；统计下钻只发送追加条件，
 * 已保存的绑定过滤由 Java 先行应用，客户端无法替换。
 */
export function requestScope(
  base: { filters?: CollectionFilter[] | null; drilldownId?: string | null },
  controls: CollectionControls,
): { filters: CollectionFilter[] | undefined; order?: CollectionOrder[] } {
  const extra = controls.filters;
  const filters = base.drilldownId
    ? (extra.length ? [...extra] : undefined)
    : extra.length ? [...(base.filters ?? []), ...extra] : (base.filters ?? undefined);
  return controls.order ? { filters, order: [controls.order] } : { filters };
}
