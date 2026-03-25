export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10 lg:px-10">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="space-y-4">
          <span className="inline-flex items-center rounded-full border border-[color:var(--line-200)] bg-white/70 px-4 py-1 text-xs font-medium tracking-[0.24em] text-[color:var(--brand-700)] uppercase shadow-[var(--shadow-soft)] backdrop-blur">
            DIP3 - Skyline Intelligence
          </span>
          <div className="max-w-3xl space-y-3">
            <h1 className="font-display text-4xl leading-tight font-semibold text-[color:var(--ink-900)] md:text-5xl">
              智慧数据分析工作台骨架已就绪
            </h1>
            <p className="max-w-2xl text-base leading-7 text-[color:var(--ink-600)]">
              当前版本完成了 Next.js App Router、亮色品牌 Token 和分层目录基线，
              后续会在这里继续落地分析会话、计划编排、证据侧栏与归因结果体验。
            </p>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className="glass-panel space-y-4 p-5">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                Route Groups
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]">
                左侧导航占位
              </h2>
            </div>
            <ul className="space-y-3 text-sm text-[color:var(--ink-600)]">
              <li className="rounded-2xl bg-white/65 px-4 py-3">`(workspace)` 分析工作台</li>
              <li className="rounded-2xl bg-white/55 px-4 py-3">`(auth)` 身份接入</li>
              <li className="rounded-2xl bg-white/55 px-4 py-3">`(admin)` 管理与审计</li>
            </ul>
          </aside>

          <section className="space-y-6">
            <article className="hero-panel p-6 md:p-8">
              <div className="space-y-4">
                <p className="text-sm font-medium text-[color:var(--brand-700)]">
                  Foundation Story 1.1
                </p>
                <h2 className="font-display text-2xl leading-tight font-semibold text-[color:var(--ink-900)] md:text-3xl">
                  官方脚手架已接入，后续故事将在这块主区继续生长
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-[color:var(--ink-600)] md:text-base">
                  这里先保留为中央信息主区，占位展示未来的“问题输入、分析计划、执行进度”
                  三段内容，不提前实现业务功能，但把视觉节奏和亮色布局方向先立住。
                </p>
              </div>
            </article>

            <article className="glass-panel grid gap-4 p-6 md:grid-cols-3">
              <div className="rounded-3xl bg-white/80 p-5">
                <p className="text-xs text-[color:var(--ink-600)]">Runtime</p>
                <p className="mt-2 font-display text-3xl text-[color:var(--ink-900)]">Next 16</p>
              </div>
              <div className="rounded-3xl bg-white/75 p-5">
                <p className="text-xs text-[color:var(--ink-600)]">Bundler</p>
                <p className="mt-2 font-display text-3xl text-[color:var(--ink-900)]">
                  Turbopack
                </p>
              </div>
              <div className="rounded-3xl bg-white/70 p-5">
                <p className="text-xs text-[color:var(--ink-600)]">Structure</p>
                <p className="mt-2 font-display text-3xl text-[color:var(--ink-900)]">DDD</p>
              </div>
            </article>
          </section>

          <aside className="glass-panel space-y-4 p-5">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                Evidence Rail
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]">
                右侧证据栏占位
              </h2>
            </div>
            <div className="space-y-3 text-sm text-[color:var(--ink-600)]">
              <div className="rounded-2xl bg-white/70 px-4 py-3">
                保留后续证据卡、Trace、原因排序与结论摘要的承载空间。
              </div>
              <div className="rounded-2xl bg-[color:var(--sky-100)] px-4 py-3">
                Story 1.2 起将继续接入 ERP 会话、工作台入口和历史分析。
              </div>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
