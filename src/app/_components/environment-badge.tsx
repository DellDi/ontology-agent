import { environmentBadge, type RuntimeEnvironmentView } from '@/application/runtime-environment/presentation';
import { cn } from '@/app/_lib/cn';

const TONES = {
  local: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  shared: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  warning: 'bg-destructive/10 text-destructive',
} as const;

const KIND_TEXT = { local: '本地开发（只允许本机数据库）', shared: '共享/部署环境', production: '生产环境' } as const;

/** 当前页面连接的是哪个环境；与 3000/3100 之类的访问端口无关。 */
export function EnvironmentBadge({ environment, className }: { environment: RuntimeEnvironmentView | null; className?: string }) {
  const badge = environmentBadge(environment);
  if (!badge) return null;
  return <span className={cn('inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[badge.tone], className)}
    role="status" title={badge.title}>{badge.text}</span>;
}

export function EnvironmentDetails({ environment }: { environment: RuntimeEnvironmentView | null }) {
  if (!environment) {
    return <p className="text-sm text-muted-foreground">无法读取运行环境，请确认后端版本与连接。环境说明见 docs/environments.md。</p>;
  }
  const database = environment.database;
  return <div className="space-y-3 text-sm">
    <dl className="space-y-3">
      <div className="flex gap-4"><dt className="w-16 shrink-0 text-muted-foreground">环境</dt><dd className="text-foreground">{environment.label}（{environment.name}）</dd></div>
      <div className="flex gap-4"><dt className="w-16 shrink-0 text-muted-foreground">类型</dt><dd className="text-foreground">{KIND_TEXT[environment.kind]}</dd></div>
      <div className="flex gap-4"><dt className="w-16 shrink-0 text-muted-foreground">平台库</dt>
        <dd className="min-w-0 break-all text-foreground">{database ? `${database.host}:${database.port}/${database.name}` : '仅平台管理员可见'}</dd></div>
    </dl>
    {environment.remoteDatabase ? <p className="text-xs text-destructive" role="alert">本地进程已显式允许连接非本机数据库，其 Worker 会与该库上的其他实例并行消费任务。</p> : null}
    <p className="text-xs text-muted-foreground">各环境的数据来源、账号与同步关系见 docs/environments.md。</p>
  </div>;
}
