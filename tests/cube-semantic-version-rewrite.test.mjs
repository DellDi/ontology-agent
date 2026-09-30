import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { queryRewrite } = require('../cube/conf/cube.js');

const versions = {
  'easyv-ai-application': 'app-v1',
  'easyv-forge-task': 'forge-v1',
  'easyv-generation-feedback': 'feedback-v1',
  'easyv-prototype-layout': 'layout-v1',
  'easyv-prototype-block': 'block-v1',
  'easyv-prototype-component': 'component-v1',
};
const all = { securityContext: { productVersions: versions, scope: { mode: 'all' } } };
const scoped = (values) => ({ securityContext: { productVersions: versions, scope: { mode: 'scoped', values } } });

test('原型结构对象强制绑定父应用授权与各自冻结版本', () => {
  for (const [cube, version] of [
    ['EasyvPrototypeLayout', 'layout-v1'],
    ['EasyvPrototypeBlock', 'block-v1'],
    ['EasyvPrototypeComponent', 'component-v1'],
  ]) {
    const query = queryRewrite({ measures: [`${cube}.count`] }, scoped({ userId: ['16'] }));
    assert.deepEqual(query.filters, [
      { member: 'EasyvApplication.appId', operator: 'set' },
      { member: 'EasyvApplication.userId', operator: 'equals', values: ['16'] },
      { member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['app-v1'] },
      { member: `${cube}.productVersionId`, operator: 'equals', values: [version] },
    ]);
    assert.throws(() => queryRewrite({ measures: [`${cube}.count`] },
      { securityContext: { scope: { mode: 'all' }, productVersions: { 'easyv-ai-application': 'app-v1' } } }),
      new RegExp(`SEMANTIC_VERSION_REQUIRED: ${cube}`));
  }
});

test('本体生成的 Cube 强制注入成员资格关联与冻结版本过滤', () => {
  const query = queryRewrite({
    measures: ['EasyvForgeTask.count'],
    dimensions: ['EasyvForgeTask.status'],
    timeDimensions: [{ dimension: 'EasyvForgeTask.createdAt', dateRange: ['2026-09-01', '2026-09-24'] }],
    filters: [{ or: [{ member: 'EasyvApplication.scopeType', operator: 'equals', values: ['USER'] }] }],
  }, all);

  assert.deepEqual(query.filters.slice(1), [
    { member: 'EasyvApplication.appId', operator: 'set' },
    { member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['app-v1'] },
    { member: 'EasyvForgeTask.productVersionId', operator: 'equals', values: ['forge-v1'] },
  ]);
});

test('成员资格关联会把关联 Cube 纳入版本强制，即使调用方只引用子对象', () => {
  const query = queryRewrite({ measures: ['EasyvForgeTask.count'] }, all);
  assert.deepEqual(query.filters, [
    { member: 'EasyvApplication.appId', operator: 'set' },
    { member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['app-v1'] },
    { member: 'EasyvForgeTask.productVersionId', operator: 'equals', values: ['forge-v1'] },
  ]);
});

test('限定授权范围按每个 Cube 声明的成员注入过滤', () => {
  const forge = queryRewrite({ measures: ['EasyvForgeTask.count'] }, scoped({ userId: ['16'] }));
  assert.deepEqual(forge.filters, [
    { member: 'EasyvApplication.appId', operator: 'set' },
    { member: 'EasyvApplication.userId', operator: 'equals', values: ['16'] },
    { member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['app-v1'] },
    { member: 'EasyvForgeTask.productVersionId', operator: 'equals', values: ['forge-v1'] },
  ]);

  const feedback = queryRewrite({ measures: ['EasyvFeedback.count'] }, scoped({ userId: ['16'] }));
  assert.deepEqual(feedback.filters, [
    { member: 'EasyvApplication.appId', operator: 'set' },
    { member: 'EasyvFeedback.userId', operator: 'equals', values: ['16'] },
    { member: 'EasyvApplication.userId', operator: 'equals', values: ['16'] },
    { member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['app-v1'] },
    { member: 'EasyvFeedback.productVersionId', operator: 'equals', values: ['feedback-v1'] },
  ]);
});

test('缺少或无效的授权范围上下文时拒绝查询', () => {
  const query = { measures: ['EasyvApplication.count'] };
  assert.throws(() => queryRewrite(query, { securityContext: { productVersions: versions } }), /SEMANTIC_SCOPE_REQUIRED/);
  assert.throws(() => queryRewrite(query, scoped({})), /SEMANTIC_SCOPE_REQUIRED/);
  assert.throws(() => queryRewrite(query, scoped({ userId: [] })), /SEMANTIC_SCOPE_REQUIRED/);
  assert.throws(() => queryRewrite(query, scoped({ userId: [16] })), /SEMANTIC_SCOPE_REQUIRED/);
  assert.throws(() => queryRewrite(query, scoped({ spaceId: ['1'] })), /SEMANTIC_SCOPE_UNSUPPORTED: EasyvApplication/);
});

test('缺少冻结版本上下文时拒绝查询，不回退到全部版本', () => {
  const query = { measures: ['EasyvApplication.count'] };
  const scope = { mode: 'all' };
  assert.throws(() => queryRewrite(query, { securityContext: { scope } }), /SEMANTIC_VERSION_REQUIRED: EasyvApplication/);
  assert.throws(() => queryRewrite(query, {}), /SEMANTIC_SCOPE_REQUIRED/);
  assert.throws(
    () => queryRewrite({ measures: ['EasyvForgeTask.count'] },
      { securityContext: { scope, productVersions: { 'easyv-ai-application': 'app-v1' } } }),
    /SEMANTIC_VERSION_REQUIRED: EasyvForgeTask/,
  );
});

test('禁止调用方自行引用 productVersionId', () => {
  assert.throws(() => queryRewrite({
    measures: ['EasyvApplication.count'],
    filters: [{ member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['other'] }],
  }, all), /SEMANTIC_VERSION_MEMBER_FORBIDDEN/);
  assert.throws(() => queryRewrite({
    measures: ['EasyvApplication.count'],
    dimensions: ['EasyvApplication.productVersionId'],
  }, all), /SEMANTIC_VERSION_MEMBER_FORBIDDEN/);
});

test('非本体生成的 Cube（物业）保持原样', () => {
  const original = {
    measures: ['FinancePayments.paidAmount'],
    filters: [{ member: 'FinancePayments.productVersionId', operator: 'equals', values: ['p-v1'] }],
  };
  assert.deepEqual(queryRewrite(structuredClone(original), {}), original);
});
