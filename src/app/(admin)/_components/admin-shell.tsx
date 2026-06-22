import type { ReactNode } from 'react';
import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/app/_components/button';
import { cn } from '@/app/_lib/cn';

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
    <article className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)] md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-3">
          <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
            {eyebrow}
          </p>
          <h2 className="font-display text-2xl leading-tight font-semibold text-foreground md:text-3xl">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
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
  className?: string;
};

export function AdminCard({
  title,
  description,
  children,
  trailing,
  className,
}: AdminCardProps) {
  if (!title && !description) {
    return (
      <Card className={className}>
        <CardContent className="p-6 md:p-7">
          {children}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between space-y-0 p-6 md:p-7">
        <div>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description ? (
            <CardDescription className="mt-2">{description}</CardDescription>
          ) : null}
        </div>
        {trailing}
      </CardHeader>
      <CardContent className="p-6 pt-0 md:p-7 md:pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneVariantMap: Record<StatusTone, BadgeProps['variant']> = {
  neutral: 'secondary',
  success: 'default',
  warning: 'default',
  danger: 'destructive',
  info: 'default',
};

const toneClassMap: Record<StatusTone, string> = {
  neutral: '',
  success: 'bg-success-500/14 text-[rgb(18_96_69)] hover:bg-success-500/20',
  warning: 'bg-warning-500/18 text-[rgb(143_96_22)] hover:bg-warning-500/24',
  danger: 'bg-destructive/14 text-destructive-foreground hover:bg-destructive/20',
  info: 'bg-primary/14 text-[rgb(30_71_168)] hover:bg-primary/20',
};

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <Badge
      variant={toneVariantMap[tone]}
      className={cn(
        'rounded-md px-3 py-1 text-xs font-medium',
        toneClassMap[tone],
      )}
    >
      {children}
    </Badge>
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
): StatusTone {
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

type StatusFlowStep = {
  label: string;
  status: string;
};

type StatusProgressBarProps = {
  steps: StatusFlowStep[];
  currentIndex: number;
};

export function StatusProgressBar({ steps, currentIndex }: StatusProgressBarProps) {
  return (
    <div className="flex items-start gap-0 py-4">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <div
            key={step.status}
            className="relative flex flex-1 flex-col items-center"
          >
            <div className="flex h-8 w-full items-center justify-center">
              {index > 0 && (
                <div
                  className={cn(
                    'h-0.5 w-full',
                    isCompleted ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
            </div>
            <div
              className={cn(
                'z-10 -mt-1.5 size-3 rounded-full border-2 bg-card',
                isCompleted
                  ? 'border-primary bg-primary'
                  : isCurrent
                    ? 'border-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-700)_18%,transparent)]'
                    : 'border-input',
              )}
            />
            <span
              className={cn(
                'mt-2 whitespace-nowrap text-center text-xs text-muted-foreground',
                (isCompleted || isCurrent) && 'font-semibold text-foreground',
              )}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-4 text-muted-foreground/55">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <h4 className="mb-2 text-base font-semibold text-foreground">{title}</h4>
      {description ? (
        <p className="max-w-96 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action && (
        <Button asChild className="mt-4">
          <Link href={action.href}>
            {action.label}
          </Link>
        </Button>
      )}
    </div>
  );
}

type TableHeader = {
  key: string;
  label: string;
  className?: string;
};

type DataTableProps = {
  headers: TableHeader[];
  children: ReactNode;
};

export function DataTable({ headers, children }: DataTableProps) {
  return (
    <div className="admin-table-wrapper">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header.key} className={cn('h-14 px-5 text-sm', header.className)}>
                {header.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

type TabItem = {
  key: string;
  label: string;
  count?: number;
};

type TabBarProps = {
  tabs: TabItem[];
  activeKey: string;
  basePath: string;
  paramName?: string;
};

export function TabBar({ tabs, activeKey, basePath, paramName = 'tab' }: TabBarProps) {
  return (
    <div className="flex flex-wrap border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const href = tab.key === 'all'
          ? basePath
          : `${basePath}?${paramName}=${tab.key}`;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                  isActive
                    ? 'bg-accent text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
