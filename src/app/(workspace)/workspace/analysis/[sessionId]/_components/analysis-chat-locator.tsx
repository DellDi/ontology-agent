'use client';

import { useEffect, useState } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

export type ChatLocatorMark = {
  key: string;
  label: string;
};

export function AnalysisChatLocator({ marks }: { marks: ChatLocatorMark[] }) {
  const { scrollRef, stopScroll } = useStickToBottomContext();
  const [activeKey, setActiveKey] = useState<string | null>(
    marks.at(-1)?.key ?? null,
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || marks.length < 2) return;
    const turns = marks.map(({ key }) => scroller.querySelector(`[data-chat-turn="${CSS.escape(key)}"]`));
    const updateActive = () => {
      if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2) {
        setActiveKey(marks.at(-1)?.key ?? null);
        return;
      }
      const readingLine = scroller.getBoundingClientRect().top + 8;
      const current = turns.findLastIndex((turn) => turn !== null && turn.getBoundingClientRect().top <= readingLine);
      setActiveKey(marks[Math.max(0, current)]?.key ?? null);
    };
    const resize = new ResizeObserver(updateActive);
    resize.observe(scroller);
    scroller.addEventListener('scroll', updateActive, { passive: true });
    return () => {
      resize.disconnect();
      scroller.removeEventListener('scroll', updateActive);
    };
  }, [marks, scrollRef]);

  if (marks.length < 2) return null;

  const scrollTo = (key: string) => {
    const scroller = scrollRef.current;
    const el = scroller?.querySelector(`[data-chat-turn="${CSS.escape(key)}"]`);
    if (!scroller || !el) return;
    stopScroll();
    scroller.scrollTo({
      top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <nav
      aria-label="对话定位"
      className="absolute left-2 top-1/2 z-10 hidden max-h-[min(55dvh,90%)] -translate-y-1/2 overflow-y-auto [scrollbar-width:none] xl:block"
      data-testid="analysis-chat-locator"
    >
      <ul className="flex flex-col items-start">
        {marks.map((mark) => (
          <li key={mark.key}>
            <button
              aria-label={`定位到${mark.label}`}
              aria-current={activeKey === mark.key ? 'location' : undefined}
              className="group flex h-5 w-7 items-center rounded px-1 focus-visible:outline focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
              onClick={() => scrollTo(mark.key)}
              title={mark.label}
              type="button"
            >
              <span
                className={`h-0.5 rounded-full transition-colors motion-reduce:transition-none ${
                  activeKey === mark.key
                    ? 'w-4 bg-primary'
                    : 'w-3 bg-muted-foreground/30 group-hover:bg-muted-foreground/70'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
