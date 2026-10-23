import Link from 'next/link';
import type { FailureInspection } from '@/infrastructure/java-backend/inspection-schema';

const changeLabels = {
  CHANGED_TO_FAILED: '由其他状态转为失败',
  FIRST_VISIBLE_FAILURE: '首次在可见范围出现',
  FAILED_IN_BOTH: '前后版本均失败',
  NO_BASELINE: '暂无版本可对比',
};
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未留存';
const analysisLink = (appId: string, taskId?: string) => `/workspace?${new URLSearchParams({
  draft: `查看应用 ID ${appId}${taskId ? ` 的生成任务 ${taskId}` : ' 的失败生成任务'}，读取真实任务和应用信息，定位值得继续排查的线索。不要把失败自述直接当作根因。`,
})}`;

export function InspectionView({ report }: { report: FailureInspection }) {
  const summary = report.summary;
  const pageLink = (offset: number) => `/workspace/inspection?${new URLSearchParams({ setId: report.current.id, offset: String(offset) })}`;
  return <section className="mx-auto w-full max-w-4xl space-y-9" aria-label="生成失败巡检">
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">生成失败巡检</h1>
        <Link href="/workspace/inspection" className="text-sm text-primary underline-offset-4 hover:underline">检查最新发布数据</Link>
      </div>
      <p className="text-sm text-muted-foreground">{report.scopeLabel} · 当前数据采集时点 {date(report.current.capturedAt)}</p>
      <p className="text-sm leading-6 text-muted-foreground">仅统计能关联到未删除且在权限范围内的应用生成任务。流程节点、操作反馈各自统计，不计入这里的失败总数。巡检读取已发布快照，不访问实时业务源。</p>
    </header>
    <section aria-label="巡检概览" className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="text-4xl font-semibold tabular-nums">{summary.totalFailures}</span><span className="text-sm text-muted-foreground">个失败任务</span>
      </div>
      {report.baseline ? <>
        <p className="text-xs text-muted-foreground">对比采集时点 {date(report.baseline.capturedAt)}，按同一任务 ID 和各版本中的当前授权范围核对。</p>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">由其他状态转为失败</dt><dd className="mt-2 text-2xl tabular-nums">{summary.changedToFailed}</dd></div>
          <div><dt className="text-xs text-muted-foreground">首次在可见范围出现</dt><dd className="mt-2 text-2xl tabular-nums">{summary.firstVisibleFailures}</dd></div>
          <div><dt className="text-xs text-muted-foreground">前后版本均失败</dt><dd className="mt-2 text-2xl tabular-nums">{summary.failedInBoth}</dd></div>
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">首次可见不等于刚刚发生；两个版本均失败不证明期间一直失败，也不证明根因相同。</p>
      </> : <p className="text-sm text-muted-foreground">尚无更早的完整冻结版本，{summary.withoutBaseline} 个失败任务暂不能判断变化。</p>}
    </section>
    {summary.repeatedApplications > 0 ? <section aria-label="重复失败应用" className="space-y-3">
      <h2 className="text-base font-semibold">{summary.repeatedApplications} 个应用有多次失败</h2>
      <p className="text-xs text-muted-foreground">按当前快照中的不同失败任务计数；最多列出失败数最高的 10 个应用。</p>
      <ul className="space-y-3">{report.repeatedApplications.map((app) => <li key={app.reference.objectId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="break-all">应用 {app.reference.objectId} · {app.failureCount} 个失败任务</span>
        <Link href={analysisLink(app.reference.objectId)} className="text-primary hover:underline">带入分析 →</Link>
      </li>)}</ul>
    </section> : null}
    <section aria-label="失败任务" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-base font-semibold">失败任务</h2><span className="text-xs text-muted-foreground">{report.failures.length ? `${report.offset + 1}–${report.offset + report.failures.length} / ${summary.totalFailures}` : '当前页 0 条'}</span></div>
      {!summary.totalFailures ? <p className="text-sm text-muted-foreground">当前可见范围内没有符合上述口径的失败生成任务。这不代表流程节点或操作记录也没有失败。</p> : null}
      {summary.totalFailures > 0 && !report.failures.length ? <p className="text-sm text-muted-foreground">当前页没有任务，请返回上一页查看。</p> : null}
      {report.failures.map((task) => <article key={task.reference.objectId} className="space-y-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="break-all text-sm font-medium">任务 {task.reference.objectId}</h3><span className="text-xs text-muted-foreground">{changeLabels[task.change]}</span></div>
        <p className="line-clamp-2 break-words text-sm leading-6">{task.reason?.trim() || '未留存失败自述'}</p>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground"><span>结束时间 {date(task.finishedAt)}</span><Link className="text-primary hover:underline" href={analysisLink(task.application.objectId, task.reference.objectId)}>带入分析 →</Link></div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看任务与版本依据</summary><dl className="mt-3 space-y-2 break-all">
          <div><dt>失败自述（完整）</dt><dd className="mt-1 whitespace-pre-wrap leading-6">{task.reason || '未留存失败自述'}</dd></div>
          <div><dt>应用 ID</dt><dd>{task.application.objectId}</dd></div><div><dt>创建时间</dt><dd>{date(task.createdAt)}</dd></div>
          <div><dt>对比版本状态</dt><dd>{task.previousStatus ?? '在该版本当前授权范围内不可见，或没有可对比版本'}</dd></div>
          <div><dt>任务产品版本</dt><dd>{task.reference.productVersionId}</dd></div>
        </dl></details>
      </article>)}
      <nav aria-label="巡检分页" className="flex gap-6 text-sm text-primary">
        {report.offset > 0 ? <Link href={pageLink(Math.max(0,report.offset-report.limit))}>上一页</Link> : null}
        {report.hasMore ? <Link href={pageLink(report.offset+report.limit)}>下一页</Link> : null}
      </nav>
    </section>
    <footer className="space-y-3 text-xs leading-5 text-muted-foreground">
      <p>失败原因是源任务的自述，不等于已验证的根因。“带入分析”会预填问题，后续分析按当时最新发布数据读取，不改变这份巡检的版本依据。</p>
      <details><summary className="cursor-pointer">数据版本</summary><dl className="mt-2 space-y-2 break-all"><div><dt>当前冻结集合</dt><dd>{report.current.id}</dd></div><div><dt>对比冻结集合</dt><dd>{report.baseline?.id ?? '暂无'}</dd></div></dl></details>
    </footer>
  </section>;
}
