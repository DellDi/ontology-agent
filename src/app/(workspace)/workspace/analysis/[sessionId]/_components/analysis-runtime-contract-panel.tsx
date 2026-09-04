import type { JavaExecutionSnapshot } from '@/infrastructure/java-backend/read-client';

type ConcreteCapabilityBinding = Exclude<
  JavaExecutionSnapshot['capabilityBinding'],
  { source: 'legacy/unknown' }
>;

type EvidenceProjection = NonNullable<
  JavaExecutionSnapshot['conclusionState']['evidence']
>[number];

type CoveragePair = {
  numerator: string;
  denominator: string;
  label: string;
};

const COVERAGE_PAIRS: CoveragePair[] = [
  { numerator: 'timedNodeCount', denominator: 'mainNodeCount', label: '耗时样本' },
  { numerator: 'timedTerminalTaskCount', denominator: 'terminalTaskCount', label: '终态耗时' },
  { numerator: 'ratedCount', denominator: 'operationCount', label: '评分' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, keys: string[]) {
  if (!isRecord(value)) return null;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return null;
}

function readNumber(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : null;
}

function formatCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatScope(binding: ConcreteCapabilityBinding) {
  const values = binding.resolvedScope.values;
  if ('accessMode' in values) {
    const accessMode = values.accessMode;
    return typeof accessMode === 'string' ? accessMode : 'creator-owned';
  }

  const projectIds = Array.isArray(values.projectIds) ? values.projectIds.length : 0;
  const areaIds = Array.isArray(values.areaIds) ? values.areaIds.length : 0;
  return `项目 ${projectIds} 个 · 区域 ${areaIds} 个`;
}

function evidenceFreshness(evidence: EvidenceProjection) {
  for (const row of evidence.rows) {
    const direct = readString(row, [
      'freshnessAt',
      'freshness',
      'sourceUpdatedAt',
      'ingestedAt',
      'updatedAt',
    ]);
    if (direct) return direct;

    const nested = isRecord(row.window)
      ? readString(row.window, [
          'freshnessAt',
          'freshness',
          'sourceUpdatedAt',
          'ingestedAt',
          'updatedAt',
        ])
      : null;
    if (nested) return nested;
  }

  return null;
}

function evidenceCoverage(evidence: EvidenceProjection) {
  const summaries = [`证据行 ${evidence.rows.length}/${evidence.rowCount}`];

  for (const pair of COVERAGE_PAIRS) {
    for (const row of evidence.rows) {
      const numerator = readNumber(row, pair.numerator);
      const denominator = readNumber(row, pair.denominator);
      if (numerator === null || denominator === null) continue;
      summaries.push(
        `${pair.label} ${formatCount(numerator)}/${formatCount(denominator)}`,
      );
      break;
    }
  }

  return summaries;
}

function planStepDescription(step: JavaExecutionSnapshot['planSnapshot']['steps'][number]) {
  if ('title' in step && 'objective' in step) {
    return `${step.title}：${step.objective}`;
  }
  return `类型：${step.kind}`;
}

function failurePointLabel(failurePoint: JavaExecutionSnapshot['failurePoint']) {
  const id = readString(failurePoint, ['id', 'point']);
  const title = readString(failurePoint, ['title', 'name']);
  if (id && title) return `${id} · ${title}`;
  return id ?? title;
}

function domainLabel(domainKey: string) {
  return domainKey === 'easyv' ? 'EasyV' : domainKey === 'property' ? 'Property' : domainKey;
}

export function AnalysisRuntimeContractPanel({
  snapshot,
}: {
  snapshot: JavaExecutionSnapshot | null;
}) {
  if (!snapshot) return null;

  const binding = snapshot.capabilityBinding;
  const concreteBinding = 'source' in binding ? null : binding;
  const failurePoint = failurePointLabel(snapshot.failurePoint);
  const failureCode = snapshot.errorCode
    ?? readString(snapshot.failurePoint, ['errorCode', 'code']);
  const traceId = snapshot.traceId
    ?? readString(snapshot.failurePoint, ['traceId', 'correlationId']);
  const evidence = snapshot.conclusionState.evidence ?? [];

  return (
    <article
      className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]"
      data-testid="analysis-runtime-contract-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-primary">
            运行时契约
          </p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">
            本轮分析的领域、计划与证据边界
          </h2>
        </div>
        <span
          className="rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
          data-testid="analysis-runtime-status"
        >
          {snapshot.status}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-muted p-3" data-testid="analysis-runtime-domain">
          <dt className="text-xs text-muted-foreground">domain</dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {concreteBinding ? domainLabel(concreteBinding.domainKey) : '未绑定'}
            {concreteBinding ? (
              <code className="ml-2 text-xs font-normal text-muted-foreground">
                {concreteBinding.domainKey}
              </code>
            ) : null}
          </dd>
        </div>
        <div className="rounded-lg bg-muted p-3" data-testid="analysis-runtime-capability">
          <dt className="text-xs text-muted-foreground">capability</dt>
          <dd className="mt-1 break-all text-sm font-semibold text-foreground">
            {concreteBinding?.capabilityKey ?? '未绑定'}
          </dd>
        </div>
        <div className="rounded-lg bg-muted p-3" data-testid="analysis-runtime-ontology-version">
          <dt className="text-xs text-muted-foreground">ontology version</dt>
          <dd className="mt-1 break-all text-sm font-semibold text-foreground">
            {snapshot.ontologyVersionId
              ?? concreteBinding?.ontologyVersionId
              ?? '未绑定'}
          </dd>
        </div>
        <div className="rounded-lg bg-muted p-3" data-testid="analysis-runtime-scope">
          <dt className="text-xs text-muted-foreground">scope</dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {concreteBinding ? formatScope(concreteBinding) : 'legacy/unknown'}
          </dd>
        </div>
      </dl>

      <section className="mt-5 border-t border-border pt-5" data-testid="analysis-runtime-plan">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">执行计划（plan）</h3>
          <span className="text-xs text-muted-foreground">
            {snapshot.planSnapshot.mode} · {snapshot.planSnapshot.steps.length} 步
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {snapshot.planSnapshot.summary}
        </p>
        <ol className="mt-3 space-y-2">
          {snapshot.planSnapshot.steps.map((step) => (
            <li
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              key={step.id}
            >
              <span className="mr-2 text-xs font-medium text-primary">{step.order}.</span>
              {planStepDescription(step)}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5 border-t border-border pt-5" data-testid="analysis-runtime-evidence">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            证据新鲜度与覆盖率（evidence freshness / coverage）
          </h3>
          <span className="text-xs text-muted-foreground">
            {evidence.length} 类证据
          </span>
        </div>
        {evidence.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {evidence.map((item) => {
              const freshness = evidenceFreshness(item);
              const coverage = evidenceCoverage(item);
              return (
                <div
                  className="rounded-lg border border-border bg-background p-3"
                  data-testid={`analysis-runtime-evidence-${item.source}`}
                  key={item.source}
                >
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <code className="mt-1 block break-all text-xs text-muted-foreground">
                    {item.source}
                  </code>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    新鲜度：{freshness ?? '源投影未提供 freshnessAt'}
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    覆盖率：{coverage.join(' · ')}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">本轮没有证据投影。</p>
        )}
      </section>

      <section className="mt-5 border-t border-border pt-5" data-testid="analysis-runtime-failure">
        <h3 className="text-sm font-semibold text-foreground">失败与诊断（failure）</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">code</dt>
            <dd className="mt-1 break-all font-mono text-foreground">{failureCode ?? '未提供'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">trace</dt>
            <dd className="mt-1 break-all font-mono text-foreground">{traceId ?? '未提供'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">failure point</dt>
            <dd className="mt-1 break-all text-foreground">{failurePoint ?? '无'}</dd>
          </div>
        </dl>
      </section>
    </article>
  );
}
