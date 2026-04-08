import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const repoRoot = process.cwd();

test('schema exports house and system user staging tables', async () => {
  const schema = await readFile(
    `${repoRoot}/src/infrastructure/postgres/schema/erp-staging.ts`,
    'utf8',
  );
  const index = await readFile(
    `${repoRoot}/src/infrastructure/postgres/schema/index.ts`,
    'utf8',
  );

  assert.match(schema, /export const erpHouses =/);
  assert.match(schema, /export const erpSystemUsers =/);
  assert.match(index, /erpHouses/);
  assert.match(index, /erpSystemUsers/);
});

test('schema keeps ERP staging as typed mirror tables without foreign keys', async () => {
  const schema = await readFile(
    `${repoRoot}/src/infrastructure/postgres/schema/erp-staging.ts`,
    'utf8',
  );
  const receivablesBlock = schema.match(
    /export const erpReceivables[\s\S]*?export const erpPayments/,
  )?.[0] ?? '';
  const serviceOrdersBlock = schema.match(
    /export const erpServiceOrders[\s\S]*?export const erpHouses/,
  )?.[0] ?? '';

  assert.doesNotMatch(schema, /references\(/);
  assert.match(schema, /sourceId: bigint\('source_id', \{ mode: 'bigint' \}\)\.primaryKey\(\)/);
  assert.match(schema, /organizationType: integer\('organization_type'\)/);
  assert.match(schema, /organizationEnableState: integer\('organization_enable_state'\)/);
  assert.match(schema, /organizationId: bigint\('organization_id', \{ mode: 'bigint' \}\)/);
  assert.match(schema, /proNature: text\('pro_nature'\)/);
  assert.match(schema, /greenArea: numeric\('green_area'\)/);
  assert.match(schema, /parkingAmount: integer\('parking_amount'\)/);
  assert.match(schema, /isDelete: integer\('is_delete'\)/);
  assert.match(schema, /enterpriseId: bigint\('enterprise_id', \{ mode: 'bigint' \}\)/);
  assert.match(schema, /shouldAccountBook: integer\('should_account_book'\)/);
  assert.doesNotMatch(receivablesBlock, /accountBook: integer\('account_book'\)/);
  assert.doesNotMatch(
    receivablesBlock,
    /actualAccountBook: integer\('actual_account_book'\)/,
  );
  assert.match(schema, /customerId: integer\('customer_id'\)/);
  assert.match(schema, /satisfaction: integer\('satisfaction'\)/);
  assert.match(schema, /isShow: integer\('is_show'\)/);
  assert.match(schema, /areaId: text\('area_id'\)/);
  assert.match(schema, /buildingId: text\('building_id'\)/);
  assert.match(schema, /regionalCompanyId: text\('regional_company_id'\)/);
  assert.match(schema, /sourceId: bigint\('source_id', \{ mode: 'bigint' \}\)\.primaryKey\(\)/);
  assert.match(schema, /password: text\('password'\)/);
  assert.match(schema, /userTelephone: text\('user_telephone'\)/);
  assert.match(schema, /userPassword: text\('user_password'\)/);
  assert.match(schema, /userType: integer\('user_type'\)/);
  assert.doesNotMatch(
    serviceOrdersBlock,
    /organizationPath: text\('organization_path'\)/,
  );
});

test('pgloader migration generator emits the expected load structure', async () => {
  const migrationModule = await import(
    `${repoRoot}/scripts/pgloader/original-mysql-migration.mjs`
  );

  assert.equal(typeof migrationModule.buildOriginalMysqlPgloaderLoad, 'function');

  const load = migrationModule.buildOriginalMysqlPgloaderLoad({
    mysqlUrl: 'mysql://user:pass@localhost:3306/original_mysql',
    postgresUrl: 'postgresql://user:pass@localhost:5432/ontology',
  });

  assert.match(load, /LOAD DATABASE/i);
  assert.doesNotMatch(load, /MATERIALIZE VIEWS/i);
  assert.match(load, /INCLUDING ONLY TABLE NAMES MATCHING 'dw_datacenter_system_organization', 'dw_datacenter_precinct', 'dw_datacenter_owner', 'dw_datacenter_chargeitem', 'dw_datacenter_charge', 'dw_datacenter_bill', 'dw_datacenter_services', 'dw_datacenter_house', 'dw_datacenter_system_user'/i);
  assert.doesNotMatch(load, /ALTER TABLE NAMES MATCHING/i);
  assert.match(load, /dw_datacenter_house/i);
  assert.match(load, /dw_datacenter_system_user/i);
  assert.match(load, /workers = 1, concurrency = 1/i);
  assert.match(load, /net_read_timeout = '7200'/i);
  assert.match(load, /create no tables/i);
  assert.match(load, /foreign keys/i);
});

test('latest drizzle staging migration stays free of foreign keys and reflects typed columns', async () => {
  const migrationFiles = (await readdir(`${repoRoot}/drizzle`))
    .filter((fileName) => /^000\d+.*\.sql$/.test(fileName))
    .sort();
  const latestStagingMigration = migrationFiles
    .slice()
    .reverse()
    .find((fileName) => fileName.includes('typed_erp_staging'));

  assert.ok(latestStagingMigration, '应存在 ERP staging drizzle migration 文件');

  const migration = await readFile(
    `${repoRoot}/drizzle/${latestStagingMigration}`,
    'utf8',
  );
  const receivablesTableBlock = migration.match(
    /CREATE TABLE "erp_staging"\."dw_datacenter_charge"[\s\S]*?CREATE TABLE "erp_staging"\."dw_datacenter_bill"/,
  )?.[0] ?? '';

  assert.doesNotMatch(migration, /FOREIGN KEY/i);
  assert.doesNotMatch(migration, /REFERENCES/i);
  assert.match(migration, /"organization_code" text/);
  assert.match(migration, /"organization_type" integer/);
  assert.match(migration, /"organization_id" bigint/);
  assert.match(migration, /"pro_nature" text/);
  assert.match(migration, /"should_account_book" integer/);
  assert.doesNotMatch(receivablesTableBlock, /"account_book" integer/);
  assert.doesNotMatch(receivablesTableBlock, /"actual_account_book" integer/);
  assert.match(migration, /"customer_id" integer/);
  assert.match(migration, /"satisfaction" integer/);
  assert.match(migration, /"is_show" integer/);
  assert.match(migration, /"password" text/);
});

test('mysql view materializer emits deduped view definitions', async () => {
  const specsModule = await import(
    `${repoRoot}/scripts/pgloader/original-mysql-specs.mjs`
  );

  assert.equal(typeof specsModule.buildProjectedMysqlSelectSql, 'function');
  assert.equal(
    typeof specsModule.buildMaterializedMysqlViewDefinition,
    'function',
  );
  assert.equal(Array.isArray(specsModule.originalMysqlTableSpecs), true);

  const chargeSpec = specsModule.originalMysqlTableSpecs.find(
    (spec) => spec.sourceTable === 'dw_datacenter_charge',
  );

  assert.ok(chargeSpec);

  const sql = specsModule.buildMaterializedMysqlViewDefinition(
    chargeSpec,
    'newsee-datacenter',
  );

  assert.match(sql, /dw_datacenter_charge AS \$\$/i);
  assert.match(sql, /SELECT/i);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY `id` ORDER BY `id`\)/i);
  assert.match(sql, /FROM `newsee-datacenter`\.`dw_datacenter_charge`/i);
});

test('mysql temp table materializer emits deduped create table definitions', async () => {
  const specsModule = await import(
    `${repoRoot}/scripts/pgloader/original-mysql-specs.mjs`
  );

  const chargeSpec = specsModule.originalMysqlTableSpecs.find(
    (spec) => spec.sourceTable === 'dw_datacenter_charge',
  );

  assert.ok(chargeSpec);

  const sql = specsModule.buildProjectedMysqlCreateTableSql(
    chargeSpec,
    'newsee-datacenter',
    'newsee_datacenter_pgloader_debug',
  );

  assert.match(sql, /CREATE TABLE `newsee_datacenter_pgloader_debug`\.`dw_datacenter_charge` AS/i);
  assert.match(sql, /SELECT/i);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY `id` ORDER BY `id`\)/i);
  assert.match(sql, /FROM `newsee-datacenter`\.`dw_datacenter_charge`/i);
});
