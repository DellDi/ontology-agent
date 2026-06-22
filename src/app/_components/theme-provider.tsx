'use client';

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

/**
 * 全站主题供应器。
 * - attribute="data-theme" 与 globals.css 中的 [data-theme='dark'] 选择器配合
 * - enableSystem 允许跟随系统偏好
 * - disableTransitionOnChange 避免切换瞬间的 CSS 过渡引发闪烁
 *
 * 注意：根 <html> 必须挂 suppressHydrationWarning，避免 SSR/CSR 主题不一致告警。
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
