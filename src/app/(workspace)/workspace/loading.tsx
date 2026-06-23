import { Skeleton } from '@/app/_components/workbench/loading';
import { Surface, SurfaceBody, SurfaceHeader } from '@/app/_components/workbench/surface';

export default function WorkspaceLoading() {
  return (
    <section
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="正在加载工作台"
    >
      <Surface variant="hero">
        <SurfaceHeader
          eyebrow="经营分析工作台"
          title="正在加载你的工作台"
          description="正在读取账号权限、项目范围、历史会话和最近执行状态。"
        />
      </Surface>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['历史分析', '进行中', '失败待处理', '已完成'].map((label) => (
          <Surface key={label}>
            <SurfaceBody className="space-y-3">
              <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground">
                {label}
              </p>
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-4 w-32" />
            </SurfaceBody>
          </Surface>
        ))}
      </div>

      <Surface>
        <SurfaceHeader
          eyebrow="分析输入台"
          title="准备分析入口"
          description="工作台加载完成后即可发起新的经营分析。"
        />
        <SurfaceBody className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-11 w-32" />
          </div>
        </SurfaceBody>
      </Surface>

      <Surface>
        <SurfaceHeader eyebrow="历史会话" title="正在恢复最近的问题上下文" />
        <SurfaceBody className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </SurfaceBody>
      </Surface>
    </section>
  );
}
