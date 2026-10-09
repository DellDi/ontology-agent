'use client';

import { useState, type FormEvent } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, SlidersHorizontal, X } from 'lucide-react';

import {
  buildFilter, describeFilter, operatorChoices,
  type CollectionControls, type CollectionProperty, type ControlsAction, type FilterOperator,
} from '@/application/object-collection/collection-controls';
import { Button } from '@/components/ui/button';

const FIELD = 'h-9 min-w-0 rounded-md border border-input bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60';

/** 排序与筛选只改变展示的对象集合：由 Java 在冻结版本与当前权限内读取，变更后由调用方重置分页与选中。 */
export function ObjectCollectionControls({ properties, controls, maxFilters, disabled, onChange }: {
  properties: CollectionProperty[]; controls: CollectionControls; maxFilters: number; disabled?: boolean;
  onChange: (action: ControlsAction) => void;
}) {
  const [member, setMember] = useState(properties[0]?.key ?? '');
  const property = properties.find((item) => item.key === member) ?? properties[0];
  const choices = property ? operatorChoices(property.type) : [];
  const [operator, setOperator] = useState<FilterOperator | ''>('');
  const choice = choices.find((item) => item.operator === operator) ?? choices[0];
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const active = (controls.order ? 1 : 0) + controls.filters.length;
  const full = controls.filters.length >= maxFilters;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!property || !choice) return;
    const built = buildFilter(property, choice.operator, value);
    if (!built.ok) { setMessage(built.message); return; }
    setMessage(null); setValue('');
    onChange({ type: 'add', filter: built.filter });
  };

  return <section className="space-y-2" aria-label="对象排序与筛选">
    <details className="rounded-lg border border-border">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <SlidersHorizontal className="size-3.5" aria-hidden />排序与筛选{active ? ` · ${active}` : ''}
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground">排序字段
            <select className={FIELD} disabled={disabled} value={controls.order?.member ?? ''}
              onChange={(event) => onChange({ type: 'sort', order: event.target.value
                ? { member: event.target.value, direction: controls.order?.direction ?? 'ASC' } : null })}>
              <option value="">默认顺序</option>
              {properties.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !controls.order}
            aria-label={controls.order?.direction === 'DESC' ? '当前降序，切换为升序' : '当前升序，切换为降序'}
            onClick={() => controls.order && onChange({ type: 'sort', order: { ...controls.order, direction: controls.order.direction === 'ASC' ? 'DESC' : 'ASC' } })}>
            {controls.order?.direction === 'DESC' ? <ArrowDownWideNarrow className="size-4" aria-hidden /> : <ArrowUpNarrowWide className="size-4" aria-hidden />}
            {controls.order?.direction === 'DESC' ? '降序' : '升序'}
          </Button>
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">无值的对象始终排在最后；排序相同时按对象 ID 保持稳定翻页。</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground">筛选字段
            <select className={FIELD} disabled={disabled} value={property?.key ?? ''}
              onChange={(event) => { setMember(event.target.value); setOperator(''); setValue(''); setMessage(null); }}>
              {properties.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground">条件
            <select className={FIELD} disabled={disabled} value={choice?.operator ?? ''}
              onChange={(event) => { setOperator(event.target.value as FilterOperator); setValue(''); setMessage(null); }}>
              {choices.map((item) => <option key={item.operator} value={item.operator}>{item.label}</option>)}
            </select>
          </label>
          {choice?.needsValue ? <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground">筛选值
            {property?.type === 'BOOLEAN'
              ? <select className={FIELD} disabled={disabled} value={value} onChange={(event) => setValue(event.target.value)}>
                <option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
              : <input className={`${FIELD} w-36`} disabled={disabled} value={value} onChange={(event) => setValue(event.target.value)}
                type={property?.type === 'TIME' ? 'date' : 'text'} inputMode={property?.type === 'NUMBER' ? 'decimal' : undefined}
                autoComplete="off" />}
          </label> : null}
          <Button type="submit" size="sm" variant="outline" disabled={disabled || full}>添加筛选</Button>
        </form>
        {full ? <p className="text-[10px] text-muted-foreground" role="status">筛选条件已达上限 {maxFilters} 项，请先移除不需要的条件。</p> : null}
        {message ? <p className="text-xs text-destructive" role="alert">{message}</p> : null}
        {properties.some((item) => item.type === 'TIME') ? <p className="text-[10px] leading-4 text-muted-foreground">日期按北京时间当日 0 点计算。</p> : null}
      </div>
    </details>
    {active ? <div className="flex flex-wrap items-center gap-1.5" aria-label="已启用的排序与筛选">
      {controls.order ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">
        按{properties.find((item) => item.key === controls.order?.member)?.label ?? controls.order.member}{controls.order.direction === 'DESC' ? '降序' : '升序'}
        <button type="button" aria-label="取消排序" disabled={disabled} className="rounded-full p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onChange({ type: 'sort', order: null })}><X className="size-3" aria-hidden /></button></span> : null}
      {controls.filters.map((filter, index) => {
        const text = describeFilter(filter, properties);
        return <span key={`${text}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px]">
          {text}
          <button type="button" aria-label={`移除筛选：${text}`} disabled={disabled} className="rounded-full p-0.5 hover:bg-muted-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange({ type: 'remove', index })}><X className="size-3" aria-hidden /></button></span>;
      })}
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onChange({ type: 'clear' })}>清除全部</Button>
    </div> : null}
  </section>;
}
