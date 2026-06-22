'use client';

import { useId, useRef } from 'react';

import { Button } from '@/app/_components/workbench/button';

type ProjectScopeDialogProps = {
  summary: string;
  projects: string[];
};

export function ProjectScopeDialog({
  summary,
  projects,
}: ProjectScopeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  if (projects.length === 0) {
    return (
      <p className="mt-2 text-base text-foreground">{summary}</p>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-base font-semibold text-foreground">
        {summary}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => dialogRef.current?.showModal()}
      >
        查看项目详情
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="backdrop:bg-[rgba(14,24,44,0.32)] w-[min(720px,calc(100vw-32px))] rounded-md border border-border bg-card text-foreground"
      >
        <div className="space-y-5 p-6 md:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
                项目范围
              </p>
              <h4
                id={titleId}
                className="mt-2 text-2xl font-semibold text-foreground"
              >
                当前项目范围
              </h4>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {summary}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => dialogRef.current?.close()}
            >
              关闭
            </Button>
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border bg-card p-3 md:p-4">
            <div className="grid gap-3">
              {projects.map((projectName, index) => (
                <div
                  key={`${projectName}-${index}`}
                  className="rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm leading-6 text-foreground"
                >
                  {projectName}
                </div>
              ))}
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
