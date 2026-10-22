'use client';

import type { IngestionHealth } from '@/infrastructure/java-backend/ingestion-schema';
import { formatTimestamp } from '../../_components/admin-shell';

const productNames: Record<string, string> = {
  'easyv-ai-application': '大屏应用',
  'easyv-prototype-task': '原型生成任务',
  'easyv-prototype-layout': '原型布局',
  'easyv-prototype-block': '原型区块',
  'easyv-prototype-component': '原型组件',
  'easyv-scheme-library': '方案库',
  'easyv-pipeline-node': '生成流程节点',
  'easyv-forge-task': '页面生成任务',
  'easyv-generation-feedback': '生成反馈',
};

export function IngestionHealthPanel({ health, onInspectRuns }: {
  health: IngestionHealth;
  onInspectRuns: () => void;
}) {
  const products = health.products.filter((product) => product.status === 'active');
  const published = products.filter((product) => product.published !== null).length;
  const failed = products.filter((product) => product.latestRun?.status === 'failed').length;
  return <section className="space-y-7" aria-label="数据健康">
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">这批数据最近检查过吗？</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        {products.length} 类数据已启用，{published} 类有可用发布版本；{failed} 类的最近相关任务失败。
        检查、发布和输入采集是三个时间点；检查成功可能复用旧版本。
      </p>
      <p className="text-xs leading-5 text-muted-foreground">当前没有配置新鲜度时限，因此只展示真实时间，不自动判定数据过期。</p>
    </div>
    <div className="space-y-8">
      {products.map((product) => {
        const run = product.latestRun;
        const failed = run?.status === 'failed';
        const checking = run?.status === 'running' || run?.status === 'pending';
        return <article key={product.key} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="break-all text-sm font-semibold">{productNames[product.key] ?? product.key}</h3>
            <span className={`text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
              {failed ? '最近任务失败' : checking ? '任务进行中' : product.published ? '已有发布版本' : '尚无发布版本'}
            </span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">最近成功检查</dt><dd className="mt-1">{product.lastSuccessfulCheckAt ? formatTimestamp(product.lastSuccessfulCheckAt) : '尚无成功检查记录'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">版本发布时间</dt><dd className="mt-1">{product.published?.publishedAt ? formatTimestamp(product.published.publishedAt) : '尚未发布'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">最早一份输入的采集完成时间</dt><dd className="mt-1">{product.published?.oldestInputAt ? formatTimestamp(product.published.oldestInputAt) : '未留存'}</dd></div>
          </dl>
          {product.published ? <p className="text-xs text-muted-foreground">发布版本含 {product.published.rowCount.toLocaleString('zh-CN')} 条记录。{failed ? '最近任务失败，上一发布版本仍保留。' : ''}</p> : null}
          {run ? <p className={`text-xs leading-5 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
            最近{run.kind === 'source' ? '采集' : '物化'}任务：{({ pending: '待执行', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消' } as const)[run.status]}
            {' · '}{formatTimestamp(run.finishedAt ?? run.startedAt ?? run.createdAt)}{run.errorCode ? ` · ${run.errorCode}` : ''}
          </p> : null}
          {run || product.published ? <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">任务与版本出处</summary>
            <dl className="mt-2 space-y-2 break-all">
              <div><dt>数据产品</dt><dd>{product.key}</dd></div>
              {run ? <div><dt>最近任务</dt><dd>{run.id}</dd></div> : null}
              {run?.correlationId ? <div><dt>关联编号</dt><dd>{run.correlationId}</dd></div> : null}
              {product.published ? <><div><dt>冻结集合</dt><dd>{product.published.setId}</dd></div><div><dt>产品版本</dt><dd>{product.published.versionId}</dd></div></> : null}
            </dl>
          </details> : null}
        </article>;
      })}
    </div>
    {!products.length ? <p className="text-sm text-muted-foreground">当前没有启用的数据产品。</p> : null}
    <button type="button" onClick={onInspectRuns} className="rounded-md py-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-ring">查看采集与物化任务 →</button>
  </section>;
}
