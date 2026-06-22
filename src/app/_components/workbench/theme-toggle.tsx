'use client';

import { useTheme } from 'next-themes';

import { cn } from '@/app/_lib/cn';

import { Button } from './button';

type ThemeToggleProps = {
  className?: string;
  /** 是否显示三态（light/dark/system）。默认 false：二态切换 light↔dark。 */
  triState?: boolean;
};

/**
 * 主题切换按钮。
 * - 二态：light ↔ dark
 * - 三态：light → dark → system → light
 * 等 mounted 后再渲染图标，避免 SSR/CSR hydration 不一致。
 */
export function ThemeToggle({ className, triState = false }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const handleClick = () => {
    if (triState) {
      if (theme === 'light') setTheme('dark');
      else if (theme === 'dark') setTheme('system');
      else setTheme('light');
      return;
    }
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  const currentMode = theme ?? 'system';
  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={
        triState
          ? `切换主题（当前：${currentMode === 'system' ? '跟随系统' : currentMode === 'dark' ? '夜间' : '日间'}）`
          : '切换日间 / 夜间主题'
      }
      onClick={handleClick}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <span aria-hidden className="inline-block" suppressHydrationWarning>
        {currentMode === 'system' ? (
          <SystemIcon />
        ) : isDark ? (
          <MoonIcon />
        ) : (
          <SunIcon />
        )}
      </span>
      <span className="text-xs" suppressHydrationWarning>
        {currentMode === 'system' ? '跟随系统' : isDark ? '夜间' : '日间'}
      </span>
    </Button>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 22h8M12 18v4" />
    </svg>
  );
}
