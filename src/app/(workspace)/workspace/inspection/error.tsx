'use client';
import Link from 'next/link';
export default function InspectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section role="alert" className="mx-auto max-w-4xl space-y-4">
    <h1 className="text-xl font-semibold">暂时无法读取巡检结果</h1>
    <p className="text-sm text-muted-foreground">请检查账号的 EasyV 权限与绑定、数据是否已发布以及当前版本是否仍保留。读取失败时不会显示空结果或部分统计。</p>
    {error.digest ? <p className="text-xs text-muted-foreground">错误编号 {error.digest}</p> : null}
    <div className="flex gap-5 text-sm text-primary"><button onClick={reset}>重试</button><Link href="/workspace/inspection">检查最新版本</Link><Link href="/workspace">返回工作台</Link></div>
  </section>;
}
