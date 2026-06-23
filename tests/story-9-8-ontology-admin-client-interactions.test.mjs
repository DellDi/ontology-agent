/**
 * Story 9.8: 本体治理后台客户端数据层与响应速度补强
 *
 * 这些测试锁住前端交互架构，而不是复测 domain 状态机：
 * - TanStack Query 负责读模型缓存和 hover prefetch
 * - Toast/Confirm 负责操作反馈与不可逆发布确认
 * - Admin loading skeleton 与客户端 Tab/Search 降低跳转等待感
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Story 9.8 Query Provider：全站挂载 TanStack Query 与 Sonner Toaster', async () => {
  const provider = await read('src/app/_components/app-query-provider.tsx');
  const layout = await read('src/app/layout.tsx');

  assert.match(provider, /QueryClientProvider/);
  assert.match(provider, /new QueryClient/);
  assert.match(provider, /<Toaster/);
  assert.match(layout, /AppQueryProvider/);
});

test('Story 9.8 Change Request 列表：客户端筛选与详情 prefetch 不依赖整页 URL Tab', async () => {
  const source = await read(
    'src/app/(admin)/admin/ontology/_components/change-request-list-client.tsx',
  );

  assert.match(source, /useQuery/);
  assert.match(source, /prefetchQuery/);
  assert.match(source, /setActiveStatus/);
  assert.doesNotMatch(source, /basePath=/);
});

test('Story 9.8 Change Request 详情：写操作使用 mutation、Toast 与发布确认', async () => {
  const source = await read(
    'src/app/(admin)/admin/ontology/_components/change-request-detail-client.tsx',
  );

  assert.match(source, /useMutation/);
  assert.match(source, /toast\.success/);
  assert.match(source, /toast\.error/);
  assert.match(source, /AlertDialog/);
  assert.match(source, /router\.push\('\/admin\/ontology\/publishes'\)/);
});

test('Story 9.8 新建变更申请：支持保存草稿与保存并提交审批两个客户端动作', async () => {
  const source = await read(
    'src/app/(admin)/admin/ontology/_components/new-change-request-client.tsx',
  );

  assert.match(source, /保存为草稿/);
  assert.match(source, /保存并提交审批/);
  assert.match(source, /submitChangeRequest/);
  assert.match(source, /FormData/);
});

test('Story 9.8 定义列表：客户端 Tab 与搜索即时过滤', async () => {
  const source = await read(
    'src/app/(admin)/admin/ontology/_components/definitions-client.tsx',
  );

  assert.match(source, /useState/);
  assert.match(source, /searchText/);
  assert.match(source, /setActiveTab/);
  assert.match(source, /filteredGroups/);
});

test('Story 9.8 Admin 路由提供 loading skeleton，慢查询时不空白等待', async () => {
  const source = await read('src/app/(admin)/loading.tsx');

  assert.match(source, /animate-pulse/);
  assert.match(source, /治理后台加载中/);
});
