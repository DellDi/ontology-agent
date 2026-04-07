import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('schema keeps the imported ERP staging tables free of foreign keys', async () => {
  const schema = await readFile(
    `${repoRoot}/src/infrastructure/postgres/schema/erp-staging.ts`,
    'utf8',
  );

  assert.match(schema, /houseId: text\('house_id'\)/);
  assert.doesNotMatch(schema, /references\(/);
  assert.match(schema, /organizationCode: text\('organization_code'\)/);
  assert.match(schema, /organizationType: text\('organization_type'\)/);
  assert.match(schema, /createUserName: text\('create_user_name'\)/);
  assert.match(schema, /proNature: text\('pro_nature'\)/);
  assert.match(schema, /greenArea: numeric\('green_area'\)/);
  assert.match(schema, /precinctArea: text\('precinct_area'\)/);
  assert.match(schema, /enterpriseId: text\('enterprise_id'\)/);
  assert.match(schema, /shouldAccountBook: integer\('should_account_book'\)/);
  assert.match(schema, /accountBook: integer\('account_book'\)/);
  assert.match(schema, /actualAccountBook: integer\('actual_account_book'\)/);
  assert.match(schema, /isShow: integer\('is_show'\)/);
  assert.match(schema, /rentStatus: text\('rent_status'\)/);
  assert.match(schema, /password: text\('password'\)/);
  assert.match(schema, /userTelephone: text\('user_telephone'\)/);
  assert.match(schema, /userPassword: text\('user_password'\)/);
});

test('pgloader migration generator emits the expected load structure', async () => {
  const module = await import(
    `${repoRoot}/scripts/pgloader/original-mysql-migration.mjs`
  );

  assert.equal(typeof module.buildOriginalMysqlPgloaderLoad, 'function');

  const load = module.buildOriginalMysqlPgloaderLoad({
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

test('drizzle migration does not add foreign keys for the staging import', async () => {
  const migration = await readFile(
    `${repoRoot}/drizzle/0003_premium_romulus.sql`,
    'utf8',
  );

  assert.doesNotMatch(migration, /FOREIGN KEY/i);
  assert.doesNotMatch(migration, /REFERENCES/i);
  assert.match(migration, /"organization_code" text/);
  assert.match(migration, /"pro_nature" text/);
  assert.match(migration, /"should_account_book" integer/);
  assert.match(migration, /"account_book" integer/);
  assert.match(migration, /"actual_account_book" integer/);
  assert.match(migration, /"is_show" integer/);
  assert.match(migration, /"password" text/);
});

test('mysql view materializer emits deduped view definitions', async () => {
  const module = await import(
    `${repoRoot}/scripts/pgloader/original-mysql-specs.mjs`
  );

  assert.equal(typeof module.buildProjectedMysqlSelectSql, 'function');
  assert.equal(
    typeof module.buildMaterializedMysqlViewDefinition,
    'function',
  );
  assert.equal(Array.isArray(module.originalMysqlTableSpecs), true);

  const chargeSpec = module.originalMysqlTableSpecs.find(
    (spec) => spec.sourceTable === 'dw_datacenter_charge',
  );

  assert.ok(chargeSpec);

  const sql = module.buildMaterializedMysqlViewDefinition(
    chargeSpec,
    'newsee-datacenter',
  );

  assert.match(sql, /dw_datacenter_charge AS \$\$/i);
  assert.match(sql, /SELECT/i);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY `id` ORDER BY `id`\)/i);
  assert.match(sql, /FROM `newsee-datacenter`\.`dw_datacenter_charge`/i);
});

test('mysql temp table materializer emits deduped create table definitions', async () => {
  const module = await import(
    `${repoRoot}/scripts/pgloader/original-mysql-specs.mjs`
  );

  const chargeSpec = module.originalMysqlTableSpecs.find(
    (spec) => spec.sourceTable === 'dw_datacenter_charge',
  );

  assert.ok(chargeSpec);

  const sql = module.buildProjectedMysqlCreateTableSql(
    chargeSpec,
    'newsee-datacenter',
    'newsee_datacenter_pgloader_debug',
  );

  assert.match(sql, /CREATE TABLE `newsee_datacenter_pgloader_debug`\.`dw_datacenter_charge` AS/i);
  assert.match(sql, /SELECT/i);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY `id` ORDER BY `id`\)/i);
  assert.match(sql, /FROM `newsee-datacenter`\.`dw_datacenter_charge`/i);
});
