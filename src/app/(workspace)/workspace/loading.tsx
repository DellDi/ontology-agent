import { Skeleton } from '@/app/_components/workbench/loading';

export default function WorkspaceLoading() {
  return (
    <section
      className="mx-auto max-w-4xl space-y-10"
      aria-busy="true"
      aria-label="正在加载你的工作台"
    >
      <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <p className="text-base font-semibold">你想分析什么？</p>
        <Skeleton className="mt-2 h-[120px] w-full animate-none border border-input" />
        <Skeleton className="mt-3 h-6 w-48 animate-none" />
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground" role="status">正在加载你的工作台…</p>
          <Skeleton className="h-11 w-32 animate-none" />
        </div>
      </div>
      <section className="space-y-4" aria-label="正在加载分析记录">
        <h2 className="text-base font-semibold">分析记录</h2>
        <Skeleton className="h-11 w-full animate-none" />
        <Skeleton className="h-20 w-full animate-none" />
        <Skeleton className="h-20 w-full animate-none" />
      </section>
    </section>
  );
}
