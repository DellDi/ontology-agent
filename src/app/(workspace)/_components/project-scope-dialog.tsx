'use client';

import { useId, useRef } from 'react';

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
      <p className="mt-2 text-base text-[color:var(--ink-900)]">{summary}</p>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-base font-semibold text-[color:var(--ink-900)]">
        {summary}
      </p>
      <button
        type="button"
        className="inline-flex items-center rounded-full border border-[color:var(--line-200)] bg-white px-4 py-2 text-sm font-medium text-[color:var(--brand-700)] shadow-[var(--shadow-soft)] transition-transform duration-200 hover:-translate-y-0.5"
        onClick={() => dialogRef.current?.showModal()}
      >
        查看项目详情
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="backdrop:bg-[rgba(14,24,44,0.32)] w-[min(720px,calc(100vw-32px))] rounded-[32px] border border-[color:var(--line-200)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,255,0.96))] p-0 text-[color:var(--ink-900)] shadow-[0_32px_80px_rgba(20,35,70,0.18)]"
      >
        <div className="space-y-5 p-6 md:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                Project Scope
              </p>
              <h4
                id={titleId}
                className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]"
              >
                当前项目范围
              </h4>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                {summary}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-[color:var(--line-200)] px-3 py-1 text-sm text-[color:var(--ink-600)]"
              onClick={() => dialogRef.current?.close()}
            >
              关闭
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-[28px] border border-[color:var(--line-200)] bg-white/80 p-3 md:p-4">
            <div className="grid gap-3">
              {projects.map((projectName, index) => (
                <div
                  key={`${projectName}-${index}`}
                  className="rounded-3xl border border-[color:var(--line-200)] bg-[color:var(--sky-50)] px-4 py-3 text-sm leading-6 text-[color:var(--ink-900)]"
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
