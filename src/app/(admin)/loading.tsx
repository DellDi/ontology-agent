export default function AdminLoading() {
  return (
    <main className="min-h-screen bg-background px-6 py-8 lg:px-10">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)] md:p-7">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary">
            治理后台加载中
          </p>
          <div className="mt-4 h-8 w-64 animate-pulse rounded-md bg-muted" />
          <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-40 animate-pulse rounded-md border border-border bg-card" />
          <div className="h-40 animate-pulse rounded-md border border-border bg-card" />
        </div>
        <div className="h-72 animate-pulse rounded-md border border-border bg-card" />
      </section>
    </main>
  );
}
