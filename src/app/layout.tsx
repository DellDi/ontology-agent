import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'DIP3 - 智慧数据',
  description: '面向物业分析团队的 AI 原生数据工作台基础骨架。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
