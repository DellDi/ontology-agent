'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ProjectScopeDialog } from './project-scope-dialog';

type ScopePopoverProps = {
  organization: string;
  projectScopeSummary: string;
  projectDisplayNames: string[];
  roles: string;
  boundaryGuidance: {
    supported: string[];
    unsupported: string[];
    note: string;
  };
  emptyState: {
    title: string;
    description: string;
  } | null;
};

export function ScopePopover({
  organization,
  projectScopeSummary,
  projectDisplayNames,
  roles,
  boundaryGuidance,
  emptyState,
}: ScopePopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        close();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, close]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-[color:var(--line-200)] bg-white px-4 py-2 text-sm font-medium text-[color:var(--brand-700)] shadow-[var(--shadow-soft)] transition-colors duration-150 hover:bg-[color:var(--surface-50)]"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
            clipRule="evenodd"
          />
        </svg>
        当前范围
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-30 mt-3 w-[min(420px,calc(100vw-32px))] rounded-lg border border-[color:var(--line-200)] bg-white p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
                当前权限范围
              </p>
              <h3 className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]">
                你当前可见的组织与作用域
              </h3>
            </div>
            <button
              type="button"
              className="rounded-md border border-[color:var(--line-200)] px-3 py-1 text-xs text-[color:var(--ink-600)]"
              onClick={close}
            >
              关闭
            </button>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-lg bg-white p-4">
              <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
                组织
              </p>
              <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
                {organization}
              </p>
            </div>
            <div className="rounded-lg bg-white p-4">
              <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
                项目
              </p>
              <ProjectScopeDialog
                summary={projectScopeSummary}
                projects={projectDisplayNames}
              />
            </div>
            <div className="rounded-lg bg-white p-4">
              <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
                角色
              </p>
              <p className="mt-2 text-base text-[color:var(--ink-900)]">
                {roles}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[color:var(--line-200)] bg-white p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              范围说明
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
                  支持范围
                </h4>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                  {boundaryGuidance.supported.join('、')}等物业分析主题。
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
                  不支持范围
                </h4>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                  {boundaryGuidance.unsupported.join('、')}等业务能力。
                </p>
              </div>
              <p className="rounded-lg bg-[color:var(--sky-50)] px-4 py-3 text-sm leading-6 text-[color:var(--ink-700)]">
                {boundaryGuidance.note}
              </p>
            </div>
          </div>

          {emptyState ? (
            <div className="mt-4 status-banner" data-tone="info">
              <p className="font-semibold text-[color:var(--ink-900)]">
                {emptyState.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                {emptyState.description}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
