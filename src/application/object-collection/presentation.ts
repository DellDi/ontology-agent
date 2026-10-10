import { formatShanghaiDateTime } from '@/lib/format-datetime';
import type { CollectionProperty } from './collection-controls';

// 显示规则来自当前对象的属性声明；不按字段名或业务对象猜测含义。
export function objectValueLabel(property: Pick<CollectionProperty, 'valueLabels'> | undefined, value: unknown): string {
  if (value == null || value === '') return '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (property?.valueLabels && Object.keys(property.valueLabels).length) return property.valueLabels[String(value)] ?? '未配置显示名称';
  return String(value);
}

export function objectValueChoices(property: Pick<CollectionProperty, 'valueLabels'> | undefined): [string, string][] {
  return Object.entries(property?.valueLabels ?? {});
}

export function objectRecordTitle(properties: Record<string, unknown>, type?: { label: string; properties: CollectionProperty[] }): string {
  const title = type?.properties.find((property) => property.title && properties[property.key] != null && properties[property.key] !== '');
  return title ? objectValueLabel(title, properties[title.key]) : type?.label ?? '记录';
}

export function objectPropertyText(property: CollectionProperty, value: unknown): string {
  return property.type === 'TIME' && typeof value === 'string' ? formatShanghaiDateTime(value) : objectValueLabel(property, value);
}

/** 历史快照曾把实际主键拼进标签；显示时移除该引用，引用本身仍用于选择和授权。 */
export function objectSelectionDisplayLabel(label: string | undefined, objectId: string): string {
  if (!label || label === objectId) return '所选对象';
  const suffix = ` · ${objectId}`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
}

export function objectRecordSelectionLabel(properties: Record<string, unknown>, type: { label: string; properties: CollectionProperty[] }): string {
  const title = objectRecordTitle(properties, type);
  if (title !== type.label) return `${type.label} · ${title}`;
  const time = type.properties.find((property) => property.type === 'TIME' && properties[property.key] != null);
  return time ? `${type.label} · ${objectPropertyText(time, properties[time.key])}` : type.label;
}
