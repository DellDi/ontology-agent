import test from 'node:test';
import assert from 'node:assert/strict';

// Story 10.6 — 自动执行优先策略的核心单元测试：
// - 区分 blocking vs non-blocking grounding 错误
// - 在非阻断缺省下生成可审计的 assumption trace
// 回归本次 review 发现 P3（零测试覆盖）并保障后续重构不破坏 AC-2/AC-3。
//
// NOTE: 项目 package.json 未声明 `"type": "module"`，tsx 将源 TS 文件编译为 CJS；
// 静态 ESM 命名导入无法感知名称，因此统一采用 `await import()` 动态加载。

type FailedItemType =
  | 'entity'
  | 'metric'
  | 'factor'
  | 'time'
  | 'version'
  | 'permission';

type FailedItem = {
  type: FailedItemType;
  text: string;
  reason: string;
};
type AmbiguousItem = {
  type: FailedItemType;
  text: string;
  candidates: string[];
};

async function loadSubjects() {
  const { OntologyGroundingError } = (await import(
    '@/domain/ontology/grounding'
  )) as { OntologyGroundingError: new (
    message: string,
    status: string,
    details: {
      ontologyVersionId: string;
      failedItems: FailedItem[];
      ambiguousItems?: AmbiguousItem[];
    },
  ) => Error & {
    details: { failedItems: FailedItem[]; ambiguousItems?: AmbiguousItem[] };
  } };
  const {
    isHardBlockingGroundingError,
    buildAutoExecutionAssumptions,
  } = (await import('@/application/ontology/grounded-planning')) as {
    isHardBlockingGroundingError: (error: unknown) => boolean;
    buildAutoExecutionAssumptions: (error: unknown) => string[];
  };

  const buildError = (input: {
    failedItems?: FailedItem[];
    ambiguousItems?: AmbiguousItem[];
  }) =>
    new OntologyGroundingError('grounding failed (test)', 'failed', {
      ontologyVersionId: 'test-version',
      failedItems: input.failedItems ?? [],
      ambiguousItems: input.ambiguousItems,
    });

  return {
    buildError,
    isHardBlockingGroundingError,
    buildAutoExecutionAssumptions,
  };
}

test('Story 10.6 | entity 失败应判为 hard blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'entity', text: '项目 X', reason: '未命中治理实体' }],
  });
  assert.equal(isHardBlockingGroundingError(error), true);
});

test('Story 10.6 | metric 失败应判为 hard blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'metric', text: '收费率', reason: '未命中治理指标' }],
  });
  assert.equal(isHardBlockingGroundingError(error), true);
});

test('Story 10.6 | version 失败应判为 hard blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [
      { type: 'version', text: 'ontology-version', reason: '无可用版本' },
    ],
  });
  assert.equal(isHardBlockingGroundingError(error), true);
});

test('Story 10.6 | permission 失败应判为 hard blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [
      { type: 'permission', text: 'scope', reason: '无权访问该版本' },
    ],
  });
  assert.equal(isHardBlockingGroundingError(error), true);
});

test('Story 10.6 | 仅 time 缺省应判为 non-blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'time', text: '上季度', reason: '无匹配时间语义' }],
  });
  assert.equal(isHardBlockingGroundingError(error), false);
});

test('Story 10.6 | 仅 factor 歧义应判为 non-blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    ambiguousItems: [
      { type: 'factor', text: '人员因素', candidates: ['staff', 'tenant'] },
    ],
  });
  assert.equal(isHardBlockingGroundingError(error), false);
});

test('Story 10.6 | time + factor 组合仍为 non-blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'time', text: '近期', reason: '无匹配时间语义' }],
    ambiguousItems: [
      { type: 'factor', text: '因素', candidates: ['a', 'b'] },
    ],
  });
  assert.equal(isHardBlockingGroundingError(error), false);
});

test('Story 10.6 | non-blocking + hard 项共存时判为 hard blocking', async () => {
  const { buildError, isHardBlockingGroundingError } = await loadSubjects();
  const error = buildError({
    failedItems: [
      { type: 'time', text: '近期', reason: '无匹配时间语义' },
      { type: 'entity', text: '项目', reason: '未命中治理实体' },
    ],
  });
  assert.equal(isHardBlockingGroundingError(error), true);
});

test('Story 10.6 | time 缺省生成时间语义假设', async () => {
  const { buildError, buildAutoExecutionAssumptions } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'time', text: '近期', reason: '无匹配时间语义' }],
  });
  const assumptions = buildAutoExecutionAssumptions(error);
  assert.equal(assumptions.length, 1);
  assert.ok(
    assumptions[0].includes('时间语义'),
    '假设文案必须显式提及时间语义',
  );
});

test('Story 10.6 | factor 歧义生成因素识别假设', async () => {
  const { buildError, buildAutoExecutionAssumptions } = await loadSubjects();
  const error = buildError({
    ambiguousItems: [
      { type: 'factor', text: '因素', candidates: ['a', 'b'] },
    ],
  });
  const assumptions = buildAutoExecutionAssumptions(error);
  assert.equal(assumptions.length, 1);
  assert.ok(
    assumptions[0].includes('因素'),
    '假设文案必须显式提及因素',
  );
});

test('Story 10.6 | time + factor 同时出现应生成两条假设', async () => {
  const { buildError, buildAutoExecutionAssumptions } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'time', text: '近期', reason: '无匹配时间语义' }],
    ambiguousItems: [{ type: 'factor', text: '因素', candidates: ['a'] }],
  });
  const assumptions = buildAutoExecutionAssumptions(error);
  assert.equal(assumptions.length, 2);
});

test('Story 10.6 | 仅 hard-blocking 项时不生成任何假设', async () => {
  const { buildError, buildAutoExecutionAssumptions } = await loadSubjects();
  const error = buildError({
    failedItems: [{ type: 'entity', text: '项目', reason: '未命中' }],
  });
  const assumptions = buildAutoExecutionAssumptions(error);
  assert.deepEqual(assumptions, []);
});
