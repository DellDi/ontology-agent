export default function AnalysisSessionLoading() {
  return (
    <section
      className="mx-auto min-h-[calc(100vh-120px)] w-full max-w-[860px] px-4 pt-2"
      aria-busy="true"
      aria-label="正在加载分析记录"
    >
      <p className="text-sm text-muted-foreground" role="status">正在加载分析记录…</p>
    </section>
  );
}
