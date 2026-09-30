'use client';

import { useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { cn } from '@/app/_lib/cn';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function WorkspaceAnalysisComposer({
  capabilities,
  draftQuestion,
  hero = false,
}: {
  capabilities: WorkspaceHomeModel['capabilities'];
  draftQuestion?: string;
  /** 空会话首页 hero 形态：无标题标签，推荐问题以列表形式展示在卡片下方 */
  hero?: boolean;
}) {
  const [question, setQuestion] = useState(draftQuestion ?? '');
  const input = useRef<HTMLTextAreaElement>(null);
  const availableCapabilities = capabilities.filter(capability => capability.available);
  const fillQuestion = (text: string) => {
    setQuestion(text);
    input.current?.focus();
  };

  return (
    <div>
      <form action="/api/analysis/sessions" method="post" className={cn(
        'rounded-lg border border-border bg-card p-5 sm:p-6',
        hero && 'rounded-2xl shadow-sm',
      )}>
        <Label
          className={hero ? 'sr-only' : 'mb-2 block text-base'}
          htmlFor="workspace-analysis-question"
        >
          你想分析什么？
        </Label>
        <Textarea
          aria-describedby="question-hint"
          autoFocus={hero}
          className={hero ? 'min-h-[110px]' : 'min-h-[120px]'}
          id="workspace-analysis-question"
          maxLength={300}
          name="question"
          onChange={event => setQuestion(event.target.value)}
          placeholder="描述分析对象、时间范围，以及你关注的变化…"
          ref={input}
          required
          value={question}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p id="question-hint" className="text-xs text-muted-foreground">最多 300 字 · 仅分析授权范围内的数据</p>
          <Button type="submit">开始分析<ArrowRight aria-hidden="true" className="size-4" /></Button>
        </div>
      </form>

      {availableCapabilities.length > 0 ? (
        hero ? (
          <ul aria-label="推荐问题" className="mt-5 space-y-0.5">
            {availableCapabilities.map(capability => (
              <li key={`${capability.domainKey}:${capability.capabilityKey}`}>
                <button
                  className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => fillQuestion(capability.exampleQuestion)}
                  type="button"
                >
                  <Sparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 truncate">{capability.exampleQuestion}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">填入示例</span>
            {availableCapabilities.map(capability => (
              <button key={`${capability.domainKey}:${capability.capabilityKey}`} type="button"
                onClick={() => fillQuestion(capability.exampleQuestion)}
                className="rounded-sm py-1 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {capability.displayName}
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
