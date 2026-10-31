import { z } from 'zod';
import type { PrototypeLayoutNode, PrototypeComponentGeometry } from '@/domain/prototype-layout/models';

type Rect = { x: number; y: number; width: number; height: number };
export type PrototypeCanvasItem = Rect & { key: string; label: string; objectId: string | null; kind: 'block' | 'content'; contentIds?: string[]; metricRole?: 'core'; chartFamily?: string; contentBox?: Rect; panelStates?: { id: string; objectId: string; label: string }[] };
export type PrototypeCanvasPage = { key: string; pageId?: string; width: number | null; height: number | null; items: PrototypeCanvasItem[]; diagnostics: string[] };
type Block = { reference: { objectId: string }; properties: Record<string, unknown> };

function number(value: string | undefined, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error('缺少页面尺寸，无法还原结构比例。');
  }
  if (!/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px)?\s*$/i.test(value)) throw new Error(`不支持的几何值：${value}`);
  const result = Number(value.trim().replace(/px$/i, ''));
  if (!Number.isFinite(result) || result < 0) throw new Error(`无效的几何值：${value}`);
  return result;
}

function orientation(node: PrototypeLayoutNode): boolean {
  const direction = node.attributes['grid-direction'] ?? node.attributes.gridDirection;
  if (direction !== undefined && direction !== 'horizontal' && direction !== 'vertical') throw new Error(`不支持的排布方向：${direction}`);
  // EasyV PrototypeStep 的语义缺省：Header/Footer 横向，其余容器纵向。
  return direction === 'horizontal' || (direction === undefined && ['header', 'footer'].includes(node.tag.toLowerCase()));
}

function units(value: string | undefined, core = false): number {
  if (value === undefined) return 1; // 源端单个 Block 的缺省 span。
  const match = /^\s*(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?\s*$/.exec(value);
  if (!match) throw new Error(`无效的跨度：${value}`);
  const n = Number(match[1]); const denominator = match[2] === undefined ? null : Number(match[2]);
  const resolved = denominator === null ? n : n / denominator * 12;
  if ((!core && !Number.isInteger(resolved)) || resolved <= 0 || resolved > 12) throw new Error(`跨度无法映射到 12 栅格：${value}`);
  return resolved;
}

function split(node: PrototypeLayoutNode, children: PrototypeLayoutNode[], rect: Rect, gap: number, blocks = false): Rect[] {
  if (children.length === 0) return [];
  const horizontal = orientation(node);
  const hasSpan = children.some((child) => child.attributes.span !== undefined);
  const spans = children.map((child, index) => hasSpan || blocks ? units(child.attributes.span, node.attributes.type === 'core-metrics')
    : Math.floor(12 / children.length) + (index < 12 % children.length ? 1 : 0));
  if (spans.some((span) => span <= 0) || spans.reduce((sum, span) => sum + span, 0) > 12 + 1e-9) throw new Error('子节点跨度超过父容器的 12 栅格，无法可靠还原。');
  const length = horizontal ? rect.width : rect.height;
  if (gap * 11 >= length) throw new Error('容器尺寸不足以容纳声明的网格间距。');
  // 与源端 layout-math 相同：扣除 11 段 gap 后计算单格，不能按 flex 比例均分。
  const cell = (length - gap * 11) / 12;
  let cursor = 0;
  return spans.map((span) => {
    const offset = cursor * (cell + gap); const size = span * cell + (span - 1) * gap; cursor += span;
    return horizontal ? { x: rect.x + offset, y: rect.y, width: size, height: rect.height }
      : { x: rect.x, y: rect.y + offset, width: rect.width, height: size };
  });
}

/** 还原源结构中的区域和主视觉；组件在独立的源栅格预览中展示。 */
export function projectPrototypeLayout(tree: PrototypeLayoutNode, blocks: readonly Block[]): PrototypeCanvasPage[] {
  const pages: PrototypeLayoutNode[] = [];
  function find(node: PrototypeLayoutNode) {
    if (node.tag.toLowerCase() === 'page') pages.push(node);
    else node.children.forEach(find);
  }
  find(tree);
  if (!pages.length) return [{ key: 'missing-page', width: null, height: null, items: [], diagnostics: ['结构中没有 Page 节点。'] }];
  return pages.map((page, pageIndex) => {
    const output: PrototypeCanvasPage = { key: `${pageIndex}:${page.attributes.id ?? 'page'}`, pageId: page.attributes.id, width: null, height: null, items: [], diagnostics: [] };
    try {
      const width = number(page.attributes.width); const height = number(page.attributes.height);
      if (width <= 0 || height <= 0) throw new Error('页面尺寸必须大于零。');
      output.width = width; output.height = height;
      const layouts = page.children.filter((child) => child.tag.toLowerCase() === 'layout');
      if (layouts.length !== 1) throw new Error('页面必须有且只有一个 Layout 节点。');
      const layout = layouts[0];
      const padding = layout.attributes.padding?.trim().split(/\s+/).map((value) => number(value)) ?? [0];
      if (padding.length > 4 || !padding.length) throw new Error('不支持的 padding 声明。');
      const [top, right = top, bottom = top, left = right] = padding;
      const rect = { x: number(layout.attributes.x, 0) + left, y: number(layout.attributes.y, 0) + top,
        width: number(layout.attributes.width, width) - left - right,
        height: number(layout.attributes.height, height) - top - bottom };
      if (rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > width || rect.y + rect.height > height) throw new Error('Layout 尺寸或边距超出页面范围。');
      const seen = new Set<string>();
      function walk(node: PrototypeLayoutNode, bounds: Rect, inheritedGap: number, path: string, contentBox?: Rect) {
        if (node.tag.toLowerCase() === 'content') {
          output.items.push({ ...bounds, key: path, label: node.attributes.id ?? '主视觉', objectId: null, kind: 'content', contentIds: [...new Set([node.attributes.id, node.attributes.ref].filter((id): id is string => Boolean(id)))], chartFamily: node.attributes.chartFamily ?? node.attributes.type, ...(contentBox ? { contentBox } : {}) }); return;
        }
        const gap = number(node.attributes.gap, inheritedGap);
        const directBlocks = node.children.filter((child) => child.tag.toLowerCase() === 'block');
        const children = directBlocks.length ? directBlocks : node.children;
        const rects = split(node, children, bounds, gap, directBlocks.length > 0);
        const coreIndex = children.findIndex(child => child.attributes.type === 'core-metrics');
        children.forEach((child, index) => {
          const childPath = `${path}.${index}`;
          if (directBlocks.length) {
            const id = child.attributes.id;
            if (!id || seen.has(id)) throw new Error('区域 ID 缺失或重复，无法绑定对象。');
            seen.add(id);
            const matches = blocks.filter((block) => block.properties.blockId === id);
            if (matches.length > 1) throw new Error(`区域 ${id} 关联了多个对象。`);
            if (!matches.length) output.diagnostics.push(`区域 ${id} 没有对应的区域对象。`);
            output.items.push({ ...rects[index], key: childPath, label: id, objectId: matches[0]?.reference.objectId ?? null, kind: 'block',
              ...(child.attributes.render === 'dynamic-panel' ? { panelStates: child.children.filter(node => node.tag.toLowerCase() === 'block').map(state => {
                const row = blocks.find(block => block.properties.blockId === state.attributes.id);
                if (!row) throw new Error(`面板状态 ${state.attributes.id} 没有对应的区域对象。`);
                return { id: state.attributes.id, objectId: row.reference.objectId, label: String(row.properties.blockTitle || row.properties.businessModule || state.attributes.id) };
              }) } : {}),
              ...((matches[0]?.properties.metricRole === 'core' || node.attributes.type === 'core-metrics' || child.attributes.metric_role === 'core' || child.attributes.metricRole === 'core') ? { metricRole: 'core' as const } : {}) });
          } else {
            let childBounds = rects[index];
            const fill = child.attributes.fillLayout ?? child.attributes['fill-layout'];
            if (child.tag.toLowerCase() === 'content' && fill && fill !== '0' && coreIndex >= 0) {
              const core = rects[coreIndex];
              const x = Math.min(childBounds.x, core.x); const y = Math.min(childBounds.y, core.y);
              childBounds = { x, y, width: Math.max(childBounds.x + childBounds.width, core.x + core.width) - x,
                height: Math.max(childBounds.y + childBounds.height, core.y + core.height) - y };
            }
            walk(child, childBounds, gap, childPath, childBounds !== rects[index] ? rects[index] : undefined);
          }
        });
      }
      const gap = number(layout.attributes.gap, 0);
      walk(layout, rect, gap, 'layout');
      if (!output.items.length) output.diagnostics.push('结构中没有可展示的区域或主视觉。');
    } catch (error) {
      output.items = []; output.diagnostics.push(error instanceof Error ? error.message : '结构几何不可读取。');
    }
    return output;
  });
}

/** 新版读取源百分比外框；旧响应没有 geometry 字段时仍展示明确标注的近似栅格。 */
export function projectPrototypeComponents(components: readonly { reference: { objectId: string }; properties: Record<string, unknown> }[],
  geometry?: Record<string, PrototypeComponentGeometry>) {
  const items: { objectId: string; chartFamily: string; x: number; y: number; width: number; height: number }[] = [];
  const diagnostics: string[] = [];
  for (const component of components) {
    const { gridCol, gridRow, gridColSpan, gridRowSpan, chartFamily } = component.properties;
    if (geometry !== undefined) {
      const retained = geometry[component.reference.objectId];
      const box = retained?.box;
      if (retained?.status !== 'available' || !box || !Object.values(box).every(Number.isFinite)
          || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0
          || box.x + box.width > 100 || box.y + box.height > 100) {
        diagnostics.push(`组件 ${component.properties.componentId ?? component.reference.objectId} 的源位置${retained?.status === 'invalid' || box ? '无效' : '未保留'}${retained?.errorCode ? `（${retained.errorCode}）` : ''}。`);
        continue;
      }
      items.push({ objectId: component.reference.objectId, chartFamily: typeof chartFamily === 'string' ? chartFamily : '', ...box });
      continue;
    }
    if (![gridCol, gridRow, gridColSpan, gridRowSpan].every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 12)
        || Number(gridCol) + Number(gridColSpan) > 13 || Number(gridRow) + Number(gridRowSpan) > 13) {
      diagnostics.push(`组件 ${component.properties.componentId ?? component.reference.objectId} 未保留有效的 12 栅格位置。`);
      continue;
    }
    items.push({ objectId: component.reference.objectId, chartFamily: typeof chartFamily === 'string' ? chartFamily : '',
      x: (Number(gridCol) - 1) / 12 * 100, y: (Number(gridRow) - 1) / 12 * 100,
      width: Number(gridColSpan) / 12 * 100, height: Number(gridRowSpan) / 12 * 100 });
  }
  return { items, diagnostics };
}


const mainContentSchema = z.object({
  id: z.string().nullish(), title: z.string().nullish(), description: z.string().nullish(),
  metrics: z.array(z.object({ id: z.string().nullish(), name: z.string().nullish(),
    description: z.string().nullish(), sceneType: z.string().nullish(), sourceType: z.string().nullish() })).nullish(),
});
const pageSemanticsSchema = z.array(z.object({ pageId: z.string(), contents: z.array(mainContentSchema).nullish() }));
export type PrototypeMainContent = z.infer<typeof mainContentSchema>;

/** 按源页面与 Content id/ref 绑定设计文案，不能因同名或页面顺序猜关联。 */
export function readPrototypeMainContent(value: unknown, pageId: string | undefined, contentIds: string[]) {
  if (value == null || value === '') return { content: null, diagnostic: '此版本未保留主视觉设计文案。' };
  let raw: unknown;
  try { raw = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return { content: null, diagnostic: '主视觉设计文案不是有效 JSON，请在版式属性中核对源记录。' }; }
  const parsed = pageSemanticsSchema.safeParse(raw);
  if (!parsed.success) return { content: null, diagnostic: '主视觉设计文案格式无效，请在版式属性中核对源记录。' };
  const pages = parsed.data.filter(page => page.pageId === pageId);
  if (pages.length !== 1) return { content: null, diagnostic: '主视觉页面引用缺失或不唯一，无法关联设计文案。' };
  const contents = pages[0].contents?.filter(content => content.id && contentIds.includes(content.id)) ?? [];
  if (contents.length !== 1) return { content: null, diagnostic: '主视觉内容引用缺失或不唯一，无法关联设计文案。' };
  return { content: contents[0], diagnostic: null };
}

/** 源主视觉指标 ID 保留图形规格；只识别实际已有的地图规格，不按标题猜图形。 */
export function mainContentHasMap(content: PrototypeMainContent) {
  return content.metrics?.some(metric => /__(map-region|map-adcode|map-point)$/.test(metric.id ?? '')) ?? false;
}
