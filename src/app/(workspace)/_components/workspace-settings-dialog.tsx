'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Palette, Server, UserRound } from 'lucide-react';

import { cn } from '@/app/_lib/cn';
import { ThemeToggle } from '@/app/_components/theme-toggle';
import { EnvironmentDetails } from '@/app/_components/environment-badge';
import type { RuntimeEnvironmentView } from '@/application/runtime-environment/presentation';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

type SectionId = 'general' | 'account' | 'environment';

const SECTIONS: { id: SectionId; label: string; icon: typeof Palette }[] = [
  { id: 'general', label: '常规', icon: Palette },
  { id: 'account', label: '账户', icon: UserRound },
  { id: 'environment', label: '运行环境', icon: Server },
];

export type WorkspaceSettingsDialogProps = {
  environment: RuntimeEnvironmentView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userDisplayName: string;
  userId: string;
};

/**
 * 设置中心弹窗（仿 ChatGPT 设置）：左侧分组导航 + 右侧内容。
 * 小配置就近放这里；完整账号与能力信息仍在独立路由 /workspace/me。
 */
export function WorkspaceSettingsDialog({
  environment,
  open,
  onOpenChange,
  userDisplayName,
  userId,
}: WorkspaceSettingsDialogProps) {
  const [section, setSection] = useState<SectionId>('general');
  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <div className="grid min-h-[380px] sm:grid-cols-[180px_minmax(0,1fr)]">
          {/* 左侧分组导航 */}
          <nav
            aria-label="设置分组"
            className="border-b border-border bg-secondary/40 p-3 sm:border-b-0 sm:border-r"
          >
            <ul className="flex gap-1 sm:flex-col">
              {SECTIONS.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === section;
                return (
                  <li key={item.id}>
                    <button
                      aria-current={isActive ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'bg-secondary font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                      )}
                      onClick={() => setSection(item.id)}
                      type="button"
                    >
                      <Icon aria-hidden className="size-4" />
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* 右侧内容区 */}
          <div className="p-5">
            <h2 className="text-sm font-semibold text-foreground">
              {active.label}
            </h2>

            {section === 'general' ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">外观</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      日间 / 夜间 / 跟随系统
                    </p>
                  </div>
                  <ThemeToggle triState />
                </div>
              </div>
            ) : null}

            {section === 'account' ? (
              <div className="mt-4 space-y-4">
                <dl className="space-y-3 text-sm">
                  <div className="flex gap-4">
                    <dt className="w-16 shrink-0 text-muted-foreground">账号名称</dt>
                    <dd className="text-foreground">{userDisplayName}</dd>
                  </div>
                  <div className="flex gap-4">
                    <dt className="w-16 shrink-0 text-muted-foreground">账号 ID</dt>
                    <dd className="text-foreground">{userId}</dd>
                  </div>
                </dl>
                <Link
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-1 text-sm font-medium',
                    'text-primary underline-offset-4 hover:underline',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  href="/workspace/me"
                  onClick={() => onOpenChange(false)}
                >
                  查看完整个人中心
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            ) : null}

            {section === 'environment' ? (
              <div className="mt-4">
                <EnvironmentDetails environment={environment} />
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
