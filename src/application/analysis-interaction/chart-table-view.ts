export type ChartTableView = { columns: string[]; rows: string[][] };
export type DrilldownAccess = { has: (row: number, column: number) => boolean; open: (row: number, column: number) => void; reason: string | null };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 把已保存的图表数据按原顺序逐点展开为表格：只在所有系列逐点对齐、数值均为有限数字时提供，
 * 不合并重复标签、不补零、不推断缺失点；无法无损对应时返回 null，由调用方不提供切换。
 */
export function chartTableView(payload: Record<string, unknown>): ChartTableView | null {
  if (!Array.isArray(payload.series) || payload.series.length === 0) return null;
  const series: { name: string; points: { label: string; value: number }[] }[] = [];
  for (const [index, item] of payload.series.entries()) {
    if (!record(item) || !Array.isArray(item.points) || item.points.length === 0) return null;
    const points: { label: string; value: number }[] = [];
    for (const point of item.points) {
      if (!record(point) || typeof point.label !== 'string' || typeof point.value !== 'number' || !Number.isFinite(point.value)) return null;
      points.push({ label: point.label, value: point.value });
    }
    series.push({ name: typeof item.name === 'string' && item.name ? item.name : `系列 ${index + 1}`, points });
  }
  const [first, ...rest] = series;
  if (rest.some((item) => item.points.length !== first.points.length
      || item.points.some((point, index) => point.label !== first.points[index].label))) return null;
  return {
    columns: [payload.chartType === 'line' ? '时间' : '分组', ...series.map((item) => item.name)],
    rows: first.points.map((point, index) => [point.label, ...series.map((item) => String(item.points[index].value))]),
  };
}

/** 表格比图表多一列标签：表格第 n 列对应图表第 n-1 个系列，标签列不是统计项。 */
export function shiftDrilldownColumns(base: DrilldownAccess): DrilldownAccess {
  return {
    has: (row, column) => column > 0 && base.has(row, column - 1),
    open: (row, column) => { if (column > 0) base.open(row, column - 1); },
    reason: null,
  };
}
