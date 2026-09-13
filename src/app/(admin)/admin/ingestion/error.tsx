'use client';

import { InlineError } from '@/app/_components/workbench/inline-error';

export default function IngestionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <InlineError
        title="数据接入信息加载失败"
        source={error.digest ? `错误编号 ${error.digest}` : undefined}
      >
        无法获取接入状态，请重试；若持续失败，请将错误编号交给运维人员检查服务日志。
      </InlineError>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-input px-4 py-2 text-sm hover:bg-secondary"
      >
        重新加载
      </button>
    </div>
  );
}
