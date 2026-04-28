import type { ReactNode } from 'react';

type AdminPageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  trailing?: ReactNode;
};

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  trailing,
}: AdminPageHeaderProps) {
  return (
    <article className="hero-panel p-7 md:p-9">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-3">
          <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
            {eyebrow}
          </p>
          <h2 className="font-display text-3xl leading-tight font-semibold text-[color:var(--ink-900)] md:text-4xl">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-base leading-7 text-[color:var(--ink-600)]">
              {description}
            </p>
          ) : null}
        </div>
        {trailing}
      </div>
    </article>
  );
}

type AdminCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  trailing?: ReactNode;
};

export function AdminCard({
  title,
  description,
  children,
  trailing,
}: AdminCardProps) {
  return (
    <article className="glass-panel p-6 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-[color:var(--ink-900)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
              {description}
            </p>
          ) : null}
        </div>
        {trailing}
      </div>
      <div className="mt-5 space-y-3">{children}</div>
    </article>
  );
}

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  const palette: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: 'rgb(118 126 142 / 12%)', fg: 'rgb(54 64 84)' },
    success: { bg: 'rgb(49 185 130 / 14%)', fg: 'rgb(18 96 69)' },
    warning: { bg: 'rgb(255 182 72 / 18%)', fg: 'rgb(143 96 22)' },
    danger: { bg: 'rgb(228 92 92 / 14%)', fg: 'rgb(141 36 36)' },
    info: { bg: 'rgb(72 138 255 / 14%)', fg: 'rgb(30 71 168)' },
  };
  const colors = palette[tone] ?? palette.neutral;
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      {children}
    </span>
  );
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    }).format(date);
  } catch {
    return value;
  }
}

export function changeRequestStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'published':
      return 'success';
    case 'approved':
      return 'info';
    case 'submitted':
      return 'warning';
    case 'rejected':
    case 'superseded':
      return 'danger';
    default:
      return 'neutral';
  }
}
