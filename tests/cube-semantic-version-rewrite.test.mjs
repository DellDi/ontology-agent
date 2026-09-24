import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { queryRewrite } = require('../cube/conf/cube.js');

const versions = {
  'easyv-ai-application': 'app-v1',
  'easyv-forge-task': 'forge-v1',
};
const context = { securityContext: { productVersions: versions } };

test('本体生成的 Cube 按冻结版本强制注入 productVersionId 过滤', () => {
  const query = queryRewrite({
    measures: ['EasyvForgeTask.count'],
    dimensions: ['EasyvForgeTask.status'],
    timeDimensions: [{ dimension: 'EasyvForgeTask.createdAt', dateRange: ['2026-09-01', '2026-09-24'] }],
    filters: [{ or: [{ member: 'EasyvApplication.scopeType', operator: 'equals', values: ['USER'] }] }],
  }, context);

  assert.deepEqual(query.filters.slice(1), [
    { member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['app-v1'] },
    { member: 'EasyvForgeTask.productVersionId', operator: 'equals', values: ['forge-v1'] },
  ]);
});

test('缺少冻结版本上下文时拒绝查询，不回退到全部版本', () => {
  const query = { measures: ['EasyvApplication.count'] };
  assert.throws(() => queryRewrite(query, { securityContext: {} }), /SEMANTIC_VERSION_REQUIRED: EasyvApplication/);
  assert.throws(() => queryRewrite(query, {}), /SEMANTIC_VERSION_REQUIRED/);
  assert.throws(
    () => queryRewrite({ measures: ['EasyvForgeTask.count'] },
      { securityContext: { productVersions: { 'easyv-ai-application': 'app-v1' } } }),
    /SEMANTIC_VERSION_REQUIRED: EasyvForgeTask/,
  );
});

test('禁止调用方自行引用 productVersionId', () => {
  assert.throws(() => queryRewrite({
    measures: ['EasyvApplication.count'],
    filters: [{ member: 'EasyvApplication.productVersionId', operator: 'equals', values: ['other'] }],
  }, context), /SEMANTIC_VERSION_MEMBER_FORBIDDEN/);
  assert.throws(() => queryRewrite({
    measures: ['EasyvApplication.count'],
    dimensions: ['EasyvApplication.productVersionId'],
  }, context), /SEMANTIC_VERSION_MEMBER_FORBIDDEN/);
});

test('非本体生成的 Cube（物业）保持原样', () => {
  const original = {
    measures: ['FinancePayments.paidAmount'],
    filters: [{ member: 'FinancePayments.productVersionId', operator: 'equals', values: ['p-v1'] }],
  };
  assert.deepEqual(queryRewrite(structuredClone(original), {}), original);
});
