import type { Metadata } from 'next';

import { AppQueryProvider } from './_components/app-query-provider';
import { ThemeProvider } from './_components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'DIP3 - 智慧数据',
  description: '面向多业务领域的 AI 原生语义分析与执行工作台。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppQueryProvider>{children}</AppQueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
