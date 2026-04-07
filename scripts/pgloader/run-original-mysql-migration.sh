#!/usr/bin/env bash
set -euo pipefail

MYSQL_URL="${MYSQL_URL:-mysql://nssoft:nssoft123@192.168.1.143:3306/newsee-datacenter}"
DATABASE_URL="${DATABASE_URL:-postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent}"

PGLOADER_BIN="${PGLOADER_BIN:-pgloader}"
PROJECTION_DB="${PROJECTION_DB:-newsee_datacenter_pgloader_debug}"
LOAD_FILE="$(mktemp "${TMPDIR:-/tmp}/original-mysql-pgloader.XXXXXX")"
LOAD_FILE="${LOAD_FILE}.load"
SOURCE_COLUMNS_FILE="$(mktemp "${TMPDIR:-/tmp}/original-mysql-source-columns.XXXXXX.json")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export MYSQL_URL DATABASE_URL PROJECTION_DB

cleanup() {
  rm -f "$LOAD_FILE"
  rm -f "$SOURCE_COLUMNS_FILE"
  node "$SCRIPT_DIR/original-mysql-projection.mjs" \
    --action drop \
    --mysql-url "$MYSQL_URL" \
    --projection-db "$PROJECTION_DB" \
    >/dev/null 2>&1 || true
}

trap cleanup EXIT

node "$SCRIPT_DIR/original-mysql-projection.mjs" \
  --action drop \
  --mysql-url "$MYSQL_URL" \
  --projection-db "$PROJECTION_DB" >/dev/null 2>&1 || true

node "$SCRIPT_DIR/original-mysql-projection.mjs" \
  --action create \
  --mysql-url "$MYSQL_URL" \
  --projection-db "$PROJECTION_DB"

TEMP_MYSQL_URL="$(
  node <<'NODE'
const url = new URL(process.env.MYSQL_URL);
url.pathname = `/${process.env.PROJECTION_DB}`;
process.stdout.write(url.toString());
NODE
)"

SOURCE_COLUMNS_JSON="$(
  node - <<'NODE'
const mysql = require('mysql2/promise');

(async () => {
  const sourceUrl = new URL(process.env.MYSQL_URL);
  const database = decodeURIComponent(sourceUrl.pathname.replace(/^\/+/, ''));
  const connection = await mysql.createConnection({
    host: sourceUrl.hostname,
    port: sourceUrl.port ? Number(sourceUrl.port) : 3306,
    user: decodeURIComponent(sourceUrl.username),
    password: decodeURIComponent(sourceUrl.password),
    database,
  });

  try {
    const [tables] = await connection.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [database],
    );
    const tableNames = tables.map((row) => row.table_name);
    const [rows] = await connection.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name IN (${tableNames.map(() => '?').join(', ')})
       ORDER BY table_name, ordinal_position`,
      [database, ...tableNames],
    );

    const columnsByTable = {};
    for (const row of rows) {
      if (!columnsByTable[row.TABLE_NAME]) {
        columnsByTable[row.TABLE_NAME] = [];
      }
      columnsByTable[row.TABLE_NAME].push(row.COLUMN_NAME);
    }

    process.stdout.write(JSON.stringify(columnsByTable));
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
)"

printf '%s' "$SOURCE_COLUMNS_JSON" > "$SOURCE_COLUMNS_FILE"

node - <<'NODE'
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  await client.query(
    'ALTER TABLE erp_staging.dw_datacenter_chargeitem ALTER COLUMN organization_id DROP NOT NULL',
  );
  await client.query(`
    TRUNCATE TABLE
      erp_staging.dw_datacenter_system_organization,
      erp_staging.dw_datacenter_precinct,
      erp_staging.dw_datacenter_owner,
      erp_staging.dw_datacenter_chargeitem,
      erp_staging.dw_datacenter_charge,
      erp_staging.dw_datacenter_bill,
      erp_staging.dw_datacenter_services,
      erp_staging.dw_datacenter_house,
      erp_staging.dw_datacenter_system_user
    RESTART IDENTITY CASCADE
  `);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

node "$SCRIPT_DIR/original-mysql-migration.mjs" \
  --mysql-url "$TEMP_MYSQL_URL" \
  --postgres-url "$DATABASE_URL" \
  --materialize-source-database "$(node -e "const u = new URL(process.env.MYSQL_URL); process.stdout.write(decodeURIComponent(u.pathname.replace(/^\\/+/, '')));" )" \
  --source-columns-file "$SOURCE_COLUMNS_FILE" \
  > "$LOAD_FILE"

"$PGLOADER_BIN" "$LOAD_FILE"
