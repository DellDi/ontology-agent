'use client';

import { useEffect, useState } from 'react';

export type ChatLocatorMark = {
  key: string;
  label: string;
};

/**
 * 右侧会话定位条：每轮对话一枚标记，点击滚动定位。
 * 悬停/聚焦时标记以"琴弦拨动"波形散开（纯 CSS 动画，reduced-motion 下禁用）。
 */
export function AnalysisChatLocator({ marks }: { marks: ChatLocatorMark[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(
    marks.at(-1)?.key ?? null,
  );

  useEffect(() => {
    if (marks.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const key = entry.target.getAttribute('data-chat-turn');
            if (key) setActiveKey(key);
          }
        }
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 },
    );
    for (const mark of marks) {
      const el = document.querySelector(`[data-chat-turn="${mark.key}"]`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [marks]);

  if (marks.length < 2) return null;

  const scrollTo = (key: string) => {
    const el = document.querySelector(`[data-chat-turn="${key}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      aria-label="对话定位"
      className="chat-locator fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 md:flex"
      data-testid="analysis-chat-locator"
    >
      <ul className="flex flex-col items-end gap-1.5">
        {marks.map((mark, index) => (
          <li key={mark.key}>
            <button
              aria-label={`定位到${mark.label}`}
              className="chat-locator-mark group flex h-6 items-center justify-end px-1 focus-visible:outline-none"
              onClick={() => scrollTo(mark.key)}
              style={{ ['--wave-i' as string]: index }}
              type="button"
            >
              <span
                className={`chat-locator-line block rounded-full transition-colors ${
                  activeKey === mark.key
                    ? 'w-5 bg-primary'
                    : 'w-3 bg-border group-hover:bg-primary/60'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
