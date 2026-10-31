import type { IngestionHealth } from '@/infrastructure/java-backend/ingestion-schema';
import { formatTimestamp } from '../../_components/admin-shell';
import { dataGroups, dataName, updateFailureMessage } from './ingestion-presentation';

/** 只聚合平台接入记录；分析能力与用户数据权限由工作台后端决定。 */
export function IngestionHealthPanel({ health, onInspectRuns }: {
  health: IngestionHealth;
  onInspectRuns?: () => void;
}) {
  const products = health.products.filter((product) => product.status === 'active');
  const groups = [...dataGroups, {
    name: '其他数据',
    keys: products.filter(product => !dataGroups.some(group => group.keys.includes(product.key))).map(product => product.key),
  }];
  const updates = new Map<string, { run: NonNullable<IngestionHealth['products'][number]['latestRun']>; products: typeof products }>();
  for (const product of products) {
    const run = product.latestRun;
    if (!run || !['failed', 'pending', 'running'].includes(run.status)) continue;
    const key = `${run.kind}:${run.id}`;
    const group = updates.get(key) ?? { run, products: [] };
    group.products.push(product);
    updates.set(key, group);
  }
  const unpublished = products.filter(product => !product.published);
  const needsAttention = updates.size > 0 || unpublished.length > 0;
  const inputTimes = products.map(product => product.published?.oldestInputAt);
  const sharedTime = inputTimes.length > 0 && inputTimes.every(time => time && formatTimestamp(time) === formatTimestamp(inputTimes[0]))
    ? formatTimestamp(inputTimes[0]) : null;

  return <section className="space-y-8" aria-label="平台数据概况">
    {onInspectRuns ? <div className="space-y-3">
      <h2 className="text-base font-semibold">{needsAttention ? '需要关注' : products.length ? '已启用数据均已发布' : '尚未接入分析数据'}</h2>
      {[...updates.values()].map(({ run, products: affected }) => {
        const updating = run.status === 'pending' || run.status === 'running';
        const retained = affected.filter(product => product.published);
        return <div key={`${run.kind}:${run.id}`} className="space-y-1 text-sm">
          <p className={run.status === 'failed' ? 'text-destructive' : ''}>
            <span className="font-medium">{affected.map(product => dataName(product.key)).join('、')}</span> · {updating ? '正在更新' : '最近更新失败'}
          </p>
          <p className="text-muted-foreground">{retained.length ? `${retained.map(product => dataName(product.key)).join('、')}的已有发布数据仍保留。` : ''}{run.status === 'failed' ? updateFailureMessage(run.errorCode) : ''}</p>
        </div>;
      })}
      {unpublished.length ? <p className="text-sm">尚未发布：{unpublished.map(product => dataName(product.key)).join('、')}。这部分数据暂不能用于分析。</p> : null}
      {needsAttention ? <button type="button" onClick={onInspectRuns} className="py-2 text-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">查看更新与处理 →</button> : null}
    </div> : null}
    <div className="space-y-5">
      <h2 className="text-base font-semibold">数据范围与采集时间</h2>
      {sharedTime ? <p className="text-sm">现有数据最早采集于 {sharedTime}</p> : null}
      {groups.map(group => {
        const members = products.filter(product => group.keys.includes(product.key));
        if (!members.length) return null;
        const published = members.filter(product => product.published);
        const times = [...new Set(published.flatMap(product => product.published!.oldestInputAt ? [product.published!.oldestInputAt] : []))].sort((a, b) => Date.parse(a) - Date.parse(b));
        const first = times[0] ? formatTimestamp(times[0]) : null;
        const last = times.length ? formatTimestamp(times[times.length - 1]) : null;
        const missingTimes = published.some(product => !product.published!.oldestInputAt);
        const missing = members.filter(product => !product.published);
        const empty = published.filter(product => product.published!.rowCount === 0);
        return <div key={group.name} className="space-y-1 text-sm sm:grid sm:grid-cols-[10rem_1fr] sm:gap-5 sm:space-y-0">
          <h3 className="font-medium">{group.name}</h3>
          <div className="space-y-2">
            <p className="leading-6 text-muted-foreground">{members.map(product => dataName(product.key)).join('、')}</p>
            {!sharedTime && first ? <p>最早输入采集时间：{first}{last !== first ? ` 至 ${last}` : ''}</p> : null}
            {missingTimes ? <p className="text-muted-foreground">{times.length ? '部分' : ''}采集时间未留存。</p> : null}
            {missing.length ? <p>尚未发布：{missing.map(product => dataName(product.key)).join('、')}</p> : null}
            {empty.length ? <p className="text-muted-foreground">暂无记录：{empty.map(product => dataName(product.key)).join('、')}</p> : null}
          </div>
        </div>;
      })}
      {!products.length ? <p className="text-sm text-muted-foreground">尚未接入分析数据。</p> : null}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">采集时间说明</summary><p className="mt-2 leading-5">以上为平台数据的采集时间。具体分析采用的数据和时间以结果中的数据出处为准。</p></details>
    </div>
  </section>;
}
