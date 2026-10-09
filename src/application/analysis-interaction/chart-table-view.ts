export type ChartTableView = { columns: string[]; rows: string[][] };
export type DrilldownAccess = { has: (row: number, column: number) => boolean; open: (row: number, column: number) => void; reason: string | null };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 柱/折线按标签及出现次数对齐；记录原系列行号供下钻使用，缺失值不补零。 */
export function chartSeriesView(payload: Record<string, unknown>) {
  const series = Array.isArray(payload.series) ? payload.series.filter(record) : [];
  const data: { label: string; [key: string]: string | number | null }[] = [];
  const pointRows: (number | null)[][] = [];
  const positions = new Map<string, number>();
  series.forEach((item, column) => {
    const occurrences = new Map<string, number>();
    const raw = Array.isArray(item.points) ? item.points : [];
    const points = raw.flatMap((point, sourceRow) => {
      if (!record(point)) return [];
      const label = String(point.label ?? '');
      const occurrence = occurrences.get(label) ?? 0;
      occurrences.set(label, occurrence + 1);
      const key = JSON.stringify([label, occurrence]);
      return [{ point, sourceRow, label, key }];
    });
    points.forEach(({ point, sourceRow, label, key }, index) => {
      let row = positions.get(key);
      if (row === undefined) {
        // 缺失期间出现在另一系列时，放在已有相邻点之间，不追加到时间轴末尾。
        const next = points.slice(index + 1).find(entry => positions.has(entry.key));
        const previous = index > 0 ? positions.get(points[index - 1].key) : undefined;
        row = next ? positions.get(next.key)! : previous === undefined ? data.length : previous + 1;
        positions.forEach((position, existingKey) => {
          if (position >= row!) positions.set(existingKey, position + 1);
        });
        positions.set(key, row);
        const values: (typeof data)[number] = { label };
        series.forEach((_, index) => { values[`value-${index}`] = null; });
        data.splice(row, 0, values);
        pointRows.splice(row, 0, series.map(() => null));
      }
      const value = point.value;
      if (typeof value === 'number' && Number.isFinite(value)) {
        data[row][`value-${column}`] = value;
        pointRows[row][column] = sourceRow;
      }
    });
  });
  return { data, pointRows, seriesNames: series.map((item, index) =>
    typeof item.name === 'string' && item.name ? item.name : `系列 ${index + 1}`) };
}

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
