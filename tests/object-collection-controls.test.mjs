import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import controls from '../src/application/object-collection/collection-controls.ts';
import contracts from '../src/infrastructure/java-backend/object-read-contract.ts';

const { operatorChoices, buildFilter, describeFilter, reduceControls, requestScope, EMPTY_CONTROLS, MAX_USER_FILTERS } = controls;
const properties = [
  { key: 'appId', label: '应用 ID', type: 'STRING' }, { key: 'blockCount', label: '区域数', type: 'NUMBER' },
  { key: 'createdAt', label: '原型创建时间', type: 'TIME' }, { key: 'saveAsEdit', label: '是否另存编辑', type: 'BOOLEAN' },
];
const by = (key) => properties.find((property) => property.key === key);
const ok = (result) => { assert.equal(result.ok, true, result.message); return result.filter; };

test('集合控制 | 筛选算子来自属性类型，布尔只允许等于，时间只允许区间与有无值', () => {
  const operators = (type) => operatorChoices(type).map((choice) => choice.operator);
  assert.deepEqual(operators('STRING'), ['CONTAINS', 'EQUALS', 'NOT_EQUALS', 'SET', 'NOT_SET']);
  assert.deepEqual(operators('NUMBER'), ['EQUALS', 'GTE', 'LTE', 'SET', 'NOT_SET']);
  assert.deepEqual(operators('TIME'), ['GTE', 'LT', 'SET', 'NOT_SET']);
  assert.deepEqual(operators('BOOLEAN'), ['EQUALS']);
  assert.equal(operatorChoices('STRING').find((choice) => choice.operator === 'SET').needsValue, false);
  assert.equal(buildFilter(by('createdAt'), 'CONTAINS', '2026').ok, false, '类型不支持的算子必须拒绝');
});

test('集合控制 | 值按类型校验并规范化，不接受空值、非法数字、非法日期和超长文本', () => {
  assert.deepEqual(ok(buildFilter(by('appId'), 'CONTAINS', '  app-1  ')), { member: 'appId', operator: 'CONTAINS', values: ['app-1'] });
  assert.deepEqual(ok(buildFilter(by('blockCount'), 'GTE', '3')), { member: 'blockCount', operator: 'GTE', values: ['3'] });
  assert.deepEqual(ok(buildFilter(by('blockCount'), 'EQUALS', '-1.5')), { member: 'blockCount', operator: 'EQUALS', values: ['-1.5'] });
  assert.deepEqual(ok(buildFilter(by('createdAt'), 'GTE', '2026-10-08')), { member: 'createdAt', operator: 'GTE', values: ['2026-10-08T00:00:00+08:00'] });
  assert.deepEqual(ok(buildFilter(by('createdAt'), 'LT', '2026-10-09')), { member: 'createdAt', operator: 'LT', values: ['2026-10-09T00:00:00+08:00'] });
  assert.deepEqual(ok(buildFilter(by('saveAsEdit'), 'EQUALS', 'true')), { member: 'saveAsEdit', operator: 'EQUALS', values: ['true'] });
  assert.deepEqual(ok(buildFilter(by('appId'), 'SET', '忽略')), { member: 'appId', operator: 'SET', values: [] });
  for (const [property, operator, value] of [['appId', 'CONTAINS', '   '], ['appId', 'EQUALS', 'x'.repeat(501)],
    ['blockCount', 'GTE', 'abc'], ['blockCount', 'GTE', '1e3'], ['blockCount', 'GTE', ''], ['createdAt', 'GTE', '2026-02-30'],
    ['createdAt', 'GTE', '2026/10/08'], ['saveAsEdit', 'EQUALS', 'yes']]) {
    const result = buildFilter(by(property), operator, value);
    assert.equal(result.ok, false, `${property} ${operator} ${value}`);
    assert.match(result.message, /\S/);
  }
});

test('集合控制 | 变更产生新状态，重复或无变化的操作保持同一引用以免重置分页', () => {
  const filter = ok(buildFilter(by('blockCount'), 'GTE', '3'));
  const sorted = reduceControls(EMPTY_CONTROLS, { type: 'sort', order: { member: 'createdAt', direction: 'DESC' } });
  assert.deepEqual(sorted.order, { member: 'createdAt', direction: 'DESC' });
  assert.equal(reduceControls(sorted, { type: 'sort', order: { member: 'createdAt', direction: 'DESC' } }), sorted);
  assert.equal(reduceControls(EMPTY_CONTROLS, { type: 'sort', order: null }), EMPTY_CONTROLS);
  const added = reduceControls(sorted, { type: 'add', filter });
  assert.deepEqual(added.filters, [filter]);
  assert.equal(reduceControls(added, { type: 'add', filter: { ...filter } }), added, '重复筛选不重复追加');
  assert.deepEqual(reduceControls(added, { type: 'remove', index: 0 }).filters, []);
  assert.equal(reduceControls(added, { type: 'remove', index: 7 }), added);
  assert.equal(reduceControls(added, { type: 'clear' }), EMPTY_CONTROLS);
  assert.equal(reduceControls(EMPTY_CONTROLS, { type: 'clear' }), EMPTY_CONTROLS);
  let full = EMPTY_CONTROLS;
  for (let index = 0; index < MAX_USER_FILTERS + 2; index += 1) {
    full = reduceControls(full, { type: 'add', filter: { member: 'blockCount', operator: 'GTE', values: [String(index)] } });
  }
  assert.equal(full.filters.length, MAX_USER_FILTERS, '用户筛选数量有上限');
  const limited = reduceControls(reduceControls(EMPTY_CONTROLS, { type: 'add', filter }, 1), { type: 'add', filter: { ...filter, values: ['9'] } }, 1);
  assert.equal(limited.filters.length, 1, '原条件占用请求额度时，用户筛选上限随之收紧');
});

test('集合控制 | 请求合并：对象范围入口在原条件后追加，统计下钻只发送追加条件，不改变无控制时的请求', () => {
  const base = [{ member: 'parseStatus', operator: 'EQUALS', values: ['ok'] }];
  const filter = ok(buildFilter(by('blockCount'), 'GTE', '3'));
  const active = { order: { member: 'createdAt', direction: 'ASC' }, filters: [filter] };
  assert.deepEqual(requestScope({ filters: base }, EMPTY_CONTROLS), { filters: base });
  assert.deepEqual(requestScope({ filters: undefined, drilldownId: 'q1:0:count' }, EMPTY_CONTROLS), { filters: undefined });
  assert.deepEqual(requestScope({ filters: base }, active), { filters: [...base, filter], order: [active.order] });
  assert.deepEqual(requestScope({ filters: undefined, drilldownId: 'q1:0:count' }, active), { filters: [filter], order: [active.order] });
  assert.deepEqual(requestScope({ filters: base }, { order: null, filters: [filter] }).order, undefined);
});

test('集合控制 | 描述文本使用声明标签与北京时间日期', () => {
  assert.equal(describeFilter(ok(buildFilter(by('blockCount'), 'GTE', '3')), properties), '区域数 不小于 3');
  assert.equal(describeFilter(ok(buildFilter(by('createdAt'), 'LT', '2026-10-09')), properties), '原型创建时间 早于 2026-10-09');
  assert.equal(describeFilter(ok(buildFilter(by('appId'), 'NOT_SET', '')), properties), '应用 ID 无值');
  assert.equal(describeFilter(ok(buildFilter(by('saveAsEdit'), 'EQUALS', 'false')), properties), '是否另存编辑 为 否');
  assert.equal(describeFilter({ member: 'gone', operator: 'SET', values: [] }, properties), 'gone 有值', '声明变化后保留原 key，不静默丢弃');
});

test('集合控制 | 生成的请求同时满足 JSON Schema 与严格 Zod', async () => {
  const root = new URL('../contracts/backend/', import.meta.url);
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }); addFormats(ajv);
  ajv.addSchema(JSON.parse(await readFile(new URL('schemas/object-read-request.schema.json', root), 'utf8')));
  const filters = [ok(buildFilter(by('blockCount'), 'GTE', '3')), ok(buildFilter(by('createdAt'), 'GTE', '2026-10-08')), ok(buildFilter(by('appId'), 'NOT_SET', ''))];
  const scope = requestScope({ filters: undefined, drilldownId: 'q1:0:count' }, { order: { member: 'createdAt', direction: 'DESC' }, filters });
  const body = { executionId: 'execution-old', datasetVersionSetId: 'set-old', objectKey: 'easyv-prototype-layout', drilldownId: 'q1:0:count', limit: 20, offset: 0, ...scope };
  assert.equal(ajv.getSchema('object-read-request.schema.json')(body), true, ajv.errorsText());
  assert.equal(contracts.javaObjectReadRequestSchema.safeParse(body).success, true);
});
