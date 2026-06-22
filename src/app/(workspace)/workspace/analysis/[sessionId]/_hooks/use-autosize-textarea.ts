'use client';

import { useCallback, useEffect, useRef } from 'react';

type UseAutosizeTextareaOptions = {
  /** 最大高度（px）。默认 120 与原追问输入框一致。 */
  maxHeight?: number;
  /** 监听内容变化的依赖项（用于在外部 setValue 后触发 resize）。 */
  watch?: unknown;
};

/**
 * textarea 内容自适应高度的 hook。
 * 返回 ref + resize 触发函数：
 *   const { ref, resize } = useAutosizeTextarea({ maxHeight: 120 });
 *   <textarea ref={ref} onChange={(e) => { ...; resize(); }} />
 */
export function useAutosizeTextarea({
  maxHeight = 120,
  watch,
}: UseAutosizeTextareaOptions = {}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  useEffect(() => {
    resize();
  }, [resize, watch]);

  return { ref, resize } as const;
}
