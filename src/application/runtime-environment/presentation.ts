export type RuntimeEnvironmentView = {
  name: string;
  label: string;
  kind: 'local' | 'shared' | 'production';
  remoteDatabase: boolean;
  database: { host: string; port: number; name: string } | null;
};
export type EnvironmentBadgeView = { text: string; tone: 'local' | 'shared' | 'warning'; title: string };

const APP_TITLE = 'DIP3 - 智慧数据';

/** 生产环境不显示徽标；无法识别环境时给出显式告警，而不是当作没有问题。 */
export function environmentBadge(environment: RuntimeEnvironmentView | null): EnvironmentBadgeView | null {
  if (!environment) return { text: '环境未知', tone: 'warning', title: '无法读取运行环境，请确认后端版本与连接。' };
  if (environment.kind === 'production') return null;
  if (environment.remoteDatabase) {
    return { text: `${environment.label} · 连接远程库`, tone: 'warning', title: `本地进程已显式允许连接非本机数据库（${environment.name}）` };
  }
  return { text: environment.label, tone: environment.kind, title: `${environment.label} · ${environment.name}` };
}

export function environmentTitle(environment: RuntimeEnvironmentView | null): string | null {
  if (!environment) return `[环境未知] ${APP_TITLE}`;
  return environment.kind === 'production' ? null : `[${environment.label}] ${APP_TITLE}`;
}
