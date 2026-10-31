'use client';

import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
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
  /** 首页形态：突出输入，推荐问题填入草稿后由用户提交。 */
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
        'rounded-lg border border-input bg-card p-5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 sm:p-6',
        hero && 'p-5 sm:p-6',
      )}>
        <Label
          className={hero ? 'sr-only' : 'mb-2 block text-base'}
          htmlFor="workspace-analysis-question"
        >
          你想分析什么？
        </Label>
        <Textarea
          aria-describedby="question-hint"
          className={cn('resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', hero ? 'min-h-[76px] text-base sm:text-base' : 'min-h-[120px]')}
          id="workspace-analysis-question"
          maxLength={300}
          name="question"
          onChange={event => setQuestion(event.target.value)}
          placeholder={hero ? '输入大屏名称或分析问题…' : '描述分析对象、时间范围，以及你关注的变化…'}
          ref={input}
          required
          value={question}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-2">
          <p id="question-hint" className="text-xs text-muted-foreground">最多 300 字</p>
          <Button className="ml-auto shrink-0" type="submit">开始分析<ArrowRight aria-hidden="true" className="size-4" /></Button>
        </div>
      </form>

      {availableCapabilities.length > 0 ? (
        hero ? (
          <div className="mt-6">
            <p className="mb-3 text-xs text-muted-foreground">快捷提问</p>
            <ul aria-label="推荐问题" className="flex flex-wrap gap-2">
              {availableCapabilities.map(capability => (
                <li key={`${capability.domainKey}:${capability.capabilityKey}`}>
                  <button type="button" onClick={() => fillQuestion(capability.exampleQuestion)}
                    className="group inline-flex items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-foreground/80 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {capability.displayName}
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
