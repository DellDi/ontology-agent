'use client';

import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { Button } from '@/app/_components/workbench/button';
import { Field, FieldLabel, FieldTextarea } from '@/app/_components/workbench/field';

export function WorkspaceAnalysisComposer({ capabilities, draftQuestion }: {
  capabilities: WorkspaceHomeModel['capabilities'];
  draftQuestion?: string;
}) {
  const [question, setQuestion] = useState(draftQuestion ?? '');
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <form action="/api/analysis/sessions" method="post" className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <Field required>
        <FieldLabel className="text-base">你想分析什么？</FieldLabel>
        <FieldTextarea ref={input} name="question" required placeholder="描述分析对象、时间范围，以及你关注的变化…"
          value={question} onChange={event => setQuestion(event.target.value)} maxLength={300} aria-describedby="question-hint"
          className="min-h-[120px] border-0 bg-transparent px-0 shadow-none focus:ring-2" />
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-muted-foreground">填入示例</span>
        {capabilities.filter(capability => capability.available).map(capability => (
          <button key={`${capability.domainKey}:${capability.capabilityKey}`} type="button"
            onClick={() => { setQuestion(capability.exampleQuestion); input.current?.focus(); }}
            className="rounded-sm py-1 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {capability.displayName}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p id="question-hint" className="text-xs text-muted-foreground">最多 300 字 · 仅分析授权范围内的数据</p>
        <Button type="submit" variant="primary" rightIcon={<ArrowRight aria-hidden="true" className="size-4" />}>开始分析</Button>
      </div>
    </form>
  );
}
