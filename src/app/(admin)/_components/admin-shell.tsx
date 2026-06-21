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
    <article className="hero-panel p-6 md:p-7">
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
    <div className="status-progress-bar">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <div key={step.status} className="status-progress-step">
            <div className="status-progress-connector">
              {index > 0 && (
                <div
                  className={`status-progress-line ${isCompleted ? 'completed' : ''}`}
                />
              )}
            </div>
            <div
              className={`status-progress-dot ${
                isCompleted
                  ? 'completed'
                  : isCurrent
                    ? 'current'
                    : 'pending'
              }`}
            />
            <span
              className={`status-progress-label ${
                isCompleted || isCurrent ? 'active' : ''
              }`}
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
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <h4 className="empty-state-title">{title}</h4>
      {description && <p className="empty-state-description">{description}</p>}
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
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((header) => (
            <TableHead key={header.key} className={header.className}>
              {header.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
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
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const href = tab.key === 'all'
          ? basePath
          : `${basePath}?${paramName}=${tab.key}`;
        return (
          <Link
            key={tab.key}
            href={href}
            className={`tab-item ${isActive ? 'active' : ''}`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tab-count">{tab.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
