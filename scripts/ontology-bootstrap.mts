/**
 * Story 9.7 — Ontology Bootstrap CLI（operator 入口）
 *
 * 新环境初始化与状态检查的正式入口。使用方式：
 *
 *   pnpm ontology:bootstrap             # 幂等 bootstrap 首个 approved version
 *   pnpm ontology:bootstrap:status      # 检查当前 baseline completeness
 *
 * 支持标志：
 *   --status                  打印当前 baseline 状态并退出（不写入）
 *   --version-id <id>         覆盖默认 version id（默认来自 baseline 常量）
 *   --semver <x.y.z>          覆盖默认 semver
 *   --help                    打印帮助
 *
 * 设计原则：
 * - 脚本只做装配与执行，不承载业务规则。
 * - 严格遵守 clean arch：域/应用层产出 seed package 与 use case，脚本层做 IO + exit code。
 * - 幂等：已有 approved version 时返回 skipped（利用 `createOntologyBootstrapUseCases` 内置逻辑）。
 * - fail-loud：任一 bulkCreate 失败或 completeness 不通过时 `process.exit(1)`，不允许伪成功。
 *
 * 与历史脚本的关系：
 * - `scripts/seed-ontology-baseline.mts` 是 9.1/9.2 时期的半成品（不走事务边界、覆盖不完整）。
 *   本脚本上线后应替代它；旧脚本会被标记为 deprecated，保留其中 organization/owner 等
 *   扩展性 entity 作为 9.4 审批流后续引入的候选参考。
 */

import nextEnvModule from '@next/env';

// 本仓库 .mts 脚本与 .ts 源模块走 CJS interop（见 `scripts/run-real-analysis-regression.mts`）：
// - 用 `import * as ns from '...'` 拿命名空间
// - 相对路径导入，避免 `@/` 路径别名在 tsx + Node ESM 下的 interop 误差
// - 通过 `resolveModuleExport` 统一处理 CJS `default` 包裹与 ESM 命名空间两种形态
import * as postgresClientModule from '../src/infrastructure/postgres/client';
import * as versionStoreModule from '../src/infrastructure/ontology/postgres-ontology-version-store';
import * as entityStoreModule from '../src/infrastructure/ontology/postgres-ontology-entity-definition-store';
import * as metricStoreModule from '../src/infrastructure/ontology/postgres-ontology-metric-definition-store';
import * as factorStoreModule from '../src/infrastructure/ontology/postgres-ontology-factor-definition-store';
import * as planStepStoreModule from '../src/infrastructure/ontology/postgres-ontology-plan-step-template-store';
import * as variantStoreModule from '../src/infrastructure/ontology/postgres-ontology-metric-variant-store';
import * as timeStoreModule from '../src/infrastructure/ontology/postgres-ontology-time-semantic-store';
import * as causalityStoreModule from '../src/infrastructure/ontology/postgres-ontology-causality-edge-store';
import * as evidenceStoreModule from '../src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store';
import * as toolBindingStoreModule from '../src/infrastructure/ontology/postgres-ontology-tool-capability-binding-store';
import * as groundingModule from '../src/application/ontology/grounding';
import * as runtimeSeedModule from '../src/domain/ontology/runtime-seed';

function resolveModuleExport<T extends Record<string, unknown>>(moduleNamespace: T): T {
  const defaultExport = (moduleNamespace as T & { default?: T }).default;
  return defaultExport ?? moduleNamespace;
}

const { loadEnvConfig } = resolveModuleExport(nextEnvModule as unknown as Record<string, unknown>) as {
  loadEnvConfig: (dir: string) => void;
};

loadEnvConfig(process.cwd());

const { createPostgresDb } = resolveModuleExport(postgresClientModule);
const { createPostgresOntologyVersionStore } = resolveModuleExport(versionStoreModule);
const { createPostgresOntologyEntityDefinitionStore } = resolveModuleExport(entityStoreModule);
const { createPostgresOntologyMetricDefinitionStore } = resolveModuleExport(metricStoreModule);
const { createPostgresOntologyFactorDefinitionStore } = resolveModuleExport(factorStoreModule);
const { createPostgresOntologyPlanStepTemplateStore } = resolveModuleExport(planStepStoreModule);
const { createPostgresOntologyMetricVariantStore } = resolveModuleExport(variantStoreModule);
const { createPostgresOntologyTimeSemanticStore } = resolveModuleExport(timeStoreModule);
const { createPostgresOntologyCausalityEdgeStore } = resolveModuleExport(causalityStoreModule);
const { createPostgresOntologyEvidenceTypeDefinitionStore } = resolveModuleExport(evidenceStoreModule);
const { createPostgresOntologyToolCapabilityBindingStore } = resolveModuleExport(toolBindingStoreModule);
const { createOntologyBootstrapUseCases } = resolveModuleExport(groundingModule);
const { buildDefaultRuntimeOntologyPackage, DEFAULT_RUNTIME_BASELINE_EXPECTED_COUNTS } =
  resolveModuleExport(runtimeSeedModule);

const DEFAULT_VERSION_ID = 'ontv-runtime-baseline-v1-0-0';
const DEFAULT_SEMVER = '1.0.0';
const CREATED_BY = 'operator:ontology-bootstrap';

// ---------------------------------------------------------------------------
// CLI 参数解析（轻量手写，不引入 yargs/commander）
// ---------------------------------------------------------------------------

type CliOptions = {
  mode: 'bootstrap' | 'status' | 'help';
  versionId: string;
  semver: string;
};

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'bootstrap',
    versionId: DEFAULT_VERSION_ID,
    semver: DEFAULT_SEMVER,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--status':
        options.mode = 'status';
        break;
      case '--help':
      case '-h':
        options.mode = 'help';
        break;
      case '--version-id': {
        const next = argv[i + 1];
        if (!next) throw new Error('--version-id 需要跟随一个值');
        options.versionId = next;
        i += 1;
        break;
      }
      case '--semver': {
        const next = argv[i + 1];
        if (!next) throw new Error('--semver 需要跟随一个值');
        options.semver = next;
        i += 1;
        break;
      }
      default:
        if (arg.startsWith('--')) {
          throw new Error(`未识别的参数：${arg}（使用 --help 查看帮助）`);
        }
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Ontology Bootstrap CLI (Story 9.7)

用法：
  pnpm ontology:bootstrap                   幂等装载首个 approved ontology version
  pnpm ontology:bootstrap:status            打印当前 baseline 状态（不写入）

参数：
  --status                  等价于 bootstrap:status
  --version-id <id>         指定 version id（默认 ${DEFAULT_VERSION_ID}）
  --semver <x.y.z>          指定 semver（默认 ${DEFAULT_SEMVER}）
  --help                    打印本帮助

退出码：
  0  成功（包括已存在的 skipped 情况）
  1  失败（写入错误 / 完整性校验失败 / 脏状态）
`);
}

// ---------------------------------------------------------------------------
// 装配依赖
// ---------------------------------------------------------------------------

function buildDeps(db: ReturnType<typeof createPostgresDb>['db']) {
  return {
    versionStore: createPostgresOntologyVersionStore(db),
    entityStore: createPostgresOntologyEntityDefinitionStore(db),
    metricStore: createPostgresOntologyMetricDefinitionStore(db),
    factorStore: createPostgresOntologyFactorDefinitionStore(db),
    planStepTemplateStore: createPostgresOntologyPlanStepTemplateStore(db),
    metricVariantStore: createPostgresOntologyMetricVariantStore(db),
    timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
    causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
    evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
    toolCapabilityBindingStore: createPostgresOntologyToolCapabilityBindingStore(db),
  };
}

// ---------------------------------------------------------------------------
// 子命令：bootstrap
// ---------------------------------------------------------------------------

async function runBootstrap(options: CliOptions): Promise<number> {
  const { db, pool } = createPostgresDb();
  try {
    const deps = buildDeps(db);
    const useCases = createOntologyBootstrapUseCases(deps);
    const now = new Date().toISOString();
    const seedPackage = buildDefaultRuntimeOntologyPackage(options.versionId, now);

    console.log(`[ontology-bootstrap] target version = ${options.versionId} (${options.semver})`);
    console.log(`[ontology-bootstrap] seed counts =`, {
      entities: seedPackage.entities.length,
      metrics: seedPackage.metrics.length,
      factors: seedPackage.factors.length,
      planStepTemplates: seedPackage.planStepTemplates.length,
      metricVariants: seedPackage.metricVariants.length,
      timeSemantics: seedPackage.timeSemantics.length,
      causalityEdges: seedPackage.causalityEdges.length,
      evidenceTypes: seedPackage.evidenceTypes.length,
    });

    const result = await useCases.bootstrapCanonicalDefinitions({
      requestedVersionId: options.versionId,
      requestedSemver: options.semver,
      createdBy: CREATED_BY,
      seedDefinitions: {
        entities: seedPackage.entities,
        metrics: seedPackage.metrics,
        factors: seedPackage.factors,
        planStepTemplates: seedPackage.planStepTemplates,
        metricVariants: seedPackage.metricVariants,
        timeSemantics: seedPackage.timeSemantics,
        causalityEdges: seedPackage.causalityEdges,
        evidenceTypes: seedPackage.evidenceTypes,
      },
    });

    if (result.skipped) {
      console.log(`[ontology-bootstrap] ⏭  skipped: ${result.message}`);
      console.log(`[ontology-bootstrap] version status = ${result.version.status}`);
    } else {
      console.log(`[ontology-bootstrap] ✅ success: ${result.message}`);
      console.log(`[ontology-bootstrap] created counts =`, {
        entities: result.entitiesCreated,
        metrics: result.metricsCreated,
        factors: result.factorsCreated,
        planStepTemplates: result.planStepTemplatesCreated,
        metricVariants: result.metricVariantsCreated,
        timeSemantics: result.timeSemanticsCreated,
        causalityEdges: result.causalityEdgesCreated,
        evidenceTypes: result.evidenceTypesCreated,
        toolBindings: result.toolBindingsCreated,
      });
    }

    // 写入后立刻跑 completeness 检查，确保不遗留脏状态
    const status = await useCases.checkBootstrapStatus(DEFAULT_RUNTIME_BASELINE_EXPECTED_COUNTS);
    console.log(`[ontology-bootstrap] completeness: ${status.completeness.humanReadable}`);
    if (status.completeness.isComplete === false) {
      console.error(`[ontology-bootstrap] ❌ completeness check failed`);
      return 1;
    }

    return 0;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// 子命令：status
// ---------------------------------------------------------------------------

async function runStatus(): Promise<number> {
  const { db, pool } = createPostgresDb();
  try {
    const deps = buildDeps(db);
    const useCases = createOntologyBootstrapUseCases(deps);
    const status = await useCases.checkBootstrapStatus(DEFAULT_RUNTIME_BASELINE_EXPECTED_COUNTS);

    console.log(`[ontology-bootstrap:status] hasApprovedVersion = ${status.hasApprovedVersion}`);
    if (status.currentVersion) {
      console.log(
        `[ontology-bootstrap:status] current version = ${status.currentVersion.semver} (${status.currentVersion.id})`,
      );
    }
    if (status.definitionsCount) {
      console.log(`[ontology-bootstrap:status] definitions count =`, status.definitionsCount);
    }
    console.log(`[ontology-bootstrap:status] ${status.completeness.humanReadable}`);

    if (status.completeness.missingCategories.length > 0) {
      console.log(`[ontology-bootstrap:status] missing categories =`, status.completeness.missingCategories);
    }

    // 退出码：无 approved version 或 completeness 不通过 → 1
    if (!status.hasApprovedVersion || status.completeness.isComplete === false) {
      return 1;
    }
    return 0;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

async function main() {
  let options: CliOptions;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (err) {
    console.error(`[ontology-bootstrap] 参数错误：${err instanceof Error ? err.message : String(err)}`);
    printHelp();
    process.exit(2);
    return;
  }

  if (options.mode === 'help') {
    printHelp();
    process.exit(0);
    return;
  }

  try {
    const code = options.mode === 'status' ? await runStatus() : await runBootstrap(options);
    process.exit(code);
  } catch (err) {
    console.error('[ontology-bootstrap] ❌ fatal error:', err);
    process.exit(1);
  }
}

void main();
