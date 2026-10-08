import type { PrototypeLayoutNode, PrototypeComponentGeometry } from '@/domain/prototype-layout/models';

type Rect = { x: number; y: number; width: number; height: number };
export type PrototypeCanvasItem = Rect & { key: string; label: string; objectId: string | null; kind: 'block' | 'content' };
export type PrototypeCanvasPage = { key: string; width: number | null; height: number | null; items: PrototypeCanvasItem[]; diagnostics: string[] };
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

function units(value: string | undefined): number {
  if (value === undefined) return 1; // 源端单个 Block 的缺省 span。
  const match = /^\s*(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?\s*$/.exec(value);
  if (!match) throw new Error(`无效的跨度：${value}`);
  const n = Number(match[1]); const denominator = match[2] === undefined ? null : Number(match[2]);
  const resolved = denominator === null ? n : n / denominator * 12;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 12) throw new Error(`跨度无法映射到 12 栅格：${value}`);
  return resolved;
}

function split(node: PrototypeLayoutNode, children: PrototypeLayoutNode[], rect: Rect, gap: number, blocks = false): Rect[] {
  if (children.length === 0) return [];
  const horizontal = orientation(node);
  const hasSpan = children.some((child) => child.attributes.span !== undefined);
  const spans = children.map((child, index) => hasSpan || blocks ? units(child.attributes.span)
    : Math.floor(12 / children.length) + (index < 12 % children.length ? 1 : 0));
  if (spans.some((span) => span < 1) || spans.reduce((sum, span) => sum + span, 0) > 12) throw new Error('子节点跨度超过父容器的 12 栅格，无法可靠还原。');
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
    const output: PrototypeCanvasPage = { key: `${pageIndex}:${page.attributes.id ?? 'page'}`, width: null, height: null, items: [], diagnostics: [] };
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
      function walk(node: PrototypeLayoutNode, bounds: Rect, inheritedGap: number, path: string) {
        if (node.tag.toLowerCase() === 'content') {
          output.items.push({ ...bounds, key: path, label: node.attributes.id ?? '主视觉', objectId: null, kind: 'content' }); return;
        }
        const gap = number(node.attributes.gap, inheritedGap);
        const directBlocks = node.children.filter((child) => child.tag.toLowerCase() === 'block');
        const children = directBlocks.length ? directBlocks : node.children;
        const rects = split(node, children, bounds, gap, directBlocks.length > 0);
        children.forEach((child, index) => {
          const childPath = `${path}.${index}`;
          if (directBlocks.length) {
            const id = child.attributes.id;
            if (!id || seen.has(id)) throw new Error('区域 ID 缺失或重复，无法绑定对象。');
            seen.add(id);
            const matches = blocks.filter((block) => block.properties.blockId === id);
            if (matches.length > 1) throw new Error(`区域 ${id} 关联了多个对象。`);
            if (!matches.length) output.diagnostics.push(`区域 ${id} 没有对应的冻结对象。`);
            output.items.push({ ...rects[index], key: childPath, label: id, objectId: matches[0]?.reference.objectId ?? null, kind: 'block' });
          } else walk(child, rects[index], gap, childPath);
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
