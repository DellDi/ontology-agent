# Original MySQL Pgloader Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable `pgloader` migration path that loads `docs/original-mysql` data into the project’s PostgreSQL `erp_staging` schema, including the missing `house` and `system_user` tables and the key foreign-key relationships.

**Architecture:** Keep the migration split into three layers: the Drizzle schema that defines the target PostgreSQL tables and relationships, a small Node generator that assembles a `pgloader` command file with MySQL source views that alias source columns into the project’s snake_case target columns, and a shell wrapper that validates environment variables and executes `pgloader`. This keeps the source mapping explicit while still making the test run one command away.

**Tech Stack:** TypeScript, Drizzle ORM schema definitions, Node ESM helper script, bash, `pgloader`, PostgreSQL.

---

### Task 1: Extend the PostgreSQL ERP staging schema

**Files:**
- Modify: `src/infrastructure/postgres/schema/erp-staging.ts`
- Modify: `src/infrastructure/postgres/schema/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/original-mysql-pgloader-migration.test.mjs will assert that
// erpHouses and erpSystemUsers are exported from the schema entrypoint.
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/original-mysql-pgloader-migration.test.mjs`
Expected: fail because the new schema exports and migration generator do not exist yet.

- [ ] **Step 3: Write the minimal schema implementation**

```ts
// Add erpHouses and erpSystemUsers tables to erp-staging.ts.
// Add the missing source columns needed for the imported MySQL data.
// Add references for precinct/org/house relationships where the target columns already line up.
```

- [ ] **Step 4: Run the test again**

Run: `node --test tests/original-mysql-pgloader-migration.test.mjs`
Expected: pass once the schema exports are in place.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/postgres/schema/erp-staging.ts src/infrastructure/postgres/schema/index.ts
git commit -m "feat: extend erp staging schema for mysql migration"
```

### Task 2: Add the pgloader migration generator and wrapper

**Files:**
- Create: `scripts/pgloader/original-mysql-migration.mjs`
- Create: `scripts/pgloader/run-original-mysql-migration.sh`

- [ ] **Step 1: Write the failing test**

```ts
// tests/original-mysql-pgloader-migration.test.mjs will assert that the
// generator emits MATERIALIZE VIEWS, table renames, and the expected source views.
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/original-mysql-pgloader-migration.test.mjs`
Expected: fail because the generator module does not exist yet.

- [ ] **Step 3: Write the minimal generator**

```js
// Export a function that accepts mysqlUrl and postgresUrl and returns the full
// pgloader command text.
// Include source views that alias the MySQL camelCase columns to the target
// erp_staging snake_case columns.
// Use ALTER TABLE NAMES MATCHING ... RENAME TO ... so the temporary source view
// names load into the existing target PostgreSQL tables.
```

- [ ] **Step 4: Write the shell wrapper**

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${MYSQL_URL:?Set MYSQL_URL to the source MySQL connection string.}"
: "${DATABASE_URL:?Set DATABASE_URL to the target PostgreSQL connection string.}"

node ./scripts/pgloader/original-mysql-migration.mjs \
  --mysql-url "$MYSQL_URL" \
  --postgres-url "$DATABASE_URL" \
  --run
```

- [ ] **Step 5: Run the test again**

Run: `node --test tests/original-mysql-pgloader-migration.test.mjs`
Expected: pass once the generator emits the migration text.

- [ ] **Step 6: Commit**

```bash
git add scripts/pgloader/original-mysql-migration.mjs scripts/pgloader/run-original-mysql-migration.sh
git commit -m "feat: add pgloader migration generator"
```

### Task 3: Add regression coverage and verify the end-to-end script shape

**Files:**
- Create: `tests/original-mysql-pgloader-migration.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('schema exports house and system user tables', async () => {
  const schema = await readFile('src/infrastructure/postgres/schema/erp-staging.ts', 'utf8');

  assert.match(schema, /export const erpHouses =/);
  assert.match(schema, /export const erpSystemUsers =/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/original-mysql-pgloader-migration.test.mjs`
Expected: fail because the new exports and generator text are missing.

- [ ] **Step 3: Extend the assertions**

```js
// Add checks for MATERIALIZE VIEWS, ALTER TABLE NAMES MATCHING,
// and the presence of import_dw_datacenter_house / import_dw_datacenter_system_user.
```

- [ ] **Step 4: Run the test suite**

Run: `node --test tests/original-mysql-pgloader-migration.test.mjs`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/original-mysql-pgloader-migration.test.mjs
git commit -m "test: cover mysql to pgloader migration path"
```

