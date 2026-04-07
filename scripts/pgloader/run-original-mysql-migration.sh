#!/usr/bin/env bash
set -euo pipefail

MYSQL_URL="${MYSQL_URL:-mysql://7f00413c-3041-4b7b-9b04-ea9f40f671f4:uaBjtUvxcj3WJp5n@jms.new-see.com:33061/newsee-datacenter}"
DATABASE_URL="${DATABASE_URL:-postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent}"

PGLOADER_BIN="${PGLOADER_BIN:-pgloader}"
PROJECTION_DB="${PROJECTION_DB:-newsee_datacenter_pgloader_debug_check}"
LOAD_FILE="$(mktemp "${TMPDIR:-/tmp}/original-mysql-pgloader.XXXXXX")"
LOAD_FILE="${LOAD_FILE}.load"
SOURCE_COLUMNS_FILE="$(mktemp "${TMPDIR:-/tmp}/original-mysql-source-columns.XXXXXX")"
SOURCE_COLUMNS_FILE="${SOURCE_COLUMNS_FILE}.json"
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
  const tableNames = [
    'dw_datacenter_precinct',
    'dw_datacenter_owner',
    'dw_datacenter_chargeitem',
    'dw_datacenter_charge',
    'dw_datacenter_bill',
    'dw_datacenter_services',
    'dw_datacenter_house',
  ];

  async function withRetry(run) {
    let lastError;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if (attempt === 9) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    throw lastError;
  }

  const columnsByTable = {};
  for (const tableName of tableNames) {
    try {
      const rows = await withRetry(async () => {
        const tableConnection = await mysql.createConnection({
          host: sourceUrl.hostname,
          port: sourceUrl.port ? Number(sourceUrl.port) : 3306,
          user: decodeURIComponent(sourceUrl.username),
          password: decodeURIComponent(sourceUrl.password),
          database,
        });
        try {
          const [result] = await tableConnection.query(`SHOW COLUMNS FROM \`${database}\`.\`${tableName}\``);
          return result;
        } finally {
          await tableConnection.end();
        }
      });

      columnsByTable[tableName] = rows.map((row) => row.Field);
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') {
        throw error;
      }
    }
  }

  process.stdout.write(JSON.stringify(columnsByTable));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
)"

printf '%s' "$SOURCE_COLUMNS_JSON" > "$SOURCE_COLUMNS_FILE"

node "$SCRIPT_DIR/original-mysql-projection.mjs" \
  --action create \
  --mysql-url "$MYSQL_URL" \
  --projection-db "$PROJECTION_DB"

node "$SCRIPT_DIR/original-mysql-projection.mjs" \
  --action create-tables \
  --mysql-url "$MYSQL_URL" \
  --projection-db "$PROJECTION_DB" \
  --source-columns-file "$SOURCE_COLUMNS_FILE"

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
  --source-columns-file "$SOURCE_COLUMNS_FILE" \
  > "$LOAD_FILE"

"$PGLOADER_BIN" "$LOAD_FILE"
