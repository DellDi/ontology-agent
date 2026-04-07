import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import {
  buildProjectedMysqlSelectSql,
  originalMysqlTableSpecs,
} from './original-mysql-specs.mjs';

function parseMysqlUrl(mysqlUrl) {
  const url = new URL(mysqlUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

  return {
    host: url.hostname,
    connectTimeout: 10000,
    password: decodeURIComponent(url.password),
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    database,
  };
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--action') {
      args.action = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--mysql-url') {
      args.mysqlUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--projection-db') {
      args.projectionDb = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--source-columns-json') {
      args.sourceColumnsByTable = argv[index + 1]
        ? JSON.parse(argv[index + 1])
        : {};
      index += 1;
      continue;
    }

    if (current === '--source-columns-file') {
      args.sourceColumnsByTable = argv[index + 1]
        ? JSON.parse(readFileSync(argv[index + 1], 'utf8'))
        : {};
      index += 1;
      continue;
    }

    if (current === '--table-names') {
      args.tableNames = argv[index + 1]
        ? argv[index + 1].split(',').map((name) => name.trim()).filter(Boolean)
        : [];
      index += 1;
      continue;
    }
  }

  return args;
}

async function createProjectionDatabase(mysqlUrl, projectionDb) {
  const connectionInfo = parseMysqlUrl(mysqlUrl);
  const connection = await mysql.createConnection(connectionInfo);

  try {
    await connection.query(`CREATE DATABASE \`${projectionDb}\``);
  } finally {
    await connection.end();
  }
}

async function dropProjectionDatabase(mysqlUrl, projectionDb) {
  const connectionInfo = parseMysqlUrl(mysqlUrl);
  const connection = await mysql.createConnection(connectionInfo);

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${projectionDb}\``);
  } finally {
    await connection.end();
  }
}

function selectProjectionSpecs(sourceColumnsByTable, tableNames) {
  const allowedTableNames = Array.isArray(tableNames) && tableNames.length > 0
    ? new Set(tableNames)
    : sourceColumnsByTable
      ? new Set(Object.keys(sourceColumnsByTable))
      : null;

  return originalMysqlTableSpecs
    .filter((spec) => !allowedTableNames || allowedTableNames.has(spec.sourceTable))
    .map((spec) => {
      const availableColumns = sourceColumnsByTable?.[spec.sourceTable];
      if (!Array.isArray(availableColumns) || availableColumns.length === 0) {
        return spec;
      }

      const filteredColumns = spec.columns.filter(
        ([sourceColumn]) => availableColumns.includes(sourceColumn),
      );

      return {
        ...spec,
        columns: filteredColumns,
      };
    })
    .filter((spec) => spec.columns.length > 0);
}

async function createProjectionTables(mysqlUrl, projectionDb, sourceColumnsByTable, tableNames) {
  const connectionInfo = parseMysqlUrl(mysqlUrl);
  const sourceDatabase = connectionInfo.database;
  const selectedSpecs = selectProjectionSpecs(sourceColumnsByTable, tableNames);

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

  for (const spec of selectedSpecs) {
    await withRetry(async () => {
      const connection = await mysql.createConnection(connectionInfo);
      try {
        const [metadataRows] = await connection.query(
          `SHOW COLUMNS FROM \`${sourceDatabase}\`.\`${spec.sourceTable}\``,
        );
        const metadataBySourceColumn = new Map(
          metadataRows.map((row) => [row.Field, row]),
        );
        const projectedColumns = spec.columns.filter(([sourceColumn]) => metadataBySourceColumn.has(sourceColumn));

        if (projectedColumns.length === 0) {
          return;
        }

        const columnDefinitions = projectedColumns
          .map(([sourceColumn, targetColumn]) => {
            const metadata = metadataBySourceColumn.get(sourceColumn);
            return `  \`${targetColumn}\` ${metadata.Type}`;
          })
          .join(',\n');
        const targetColumns = projectedColumns
          .map(([, targetColumn]) => `\`${targetColumn}\``)
          .join(', ');

        await connection.query(`DROP TABLE IF EXISTS \`${projectionDb}\`.\`${spec.sourceTable}\``);
        await connection.query(
          `CREATE TABLE \`${projectionDb}\`.\`${spec.sourceTable}\` (\n${columnDefinitions}\n)`,
        );
        await connection.query(
          `INSERT INTO \`${projectionDb}\`.\`${spec.sourceTable}\` (${targetColumns})\n${buildProjectedMysqlSelectSql({ ...spec, columns: projectedColumns }, sourceDatabase)}`,
        );
      } finally {
        await connection.end();
      }
    });
  }
}

async function dropMaterializedViews(mysqlUrl) {
  const connectionInfo = parseMysqlUrl(mysqlUrl);
  const connection = await mysql.createConnection(connectionInfo);

  try {
    for (const spec of originalMysqlTableSpecs) {
      await connection.query(`DROP VIEW IF EXISTS \`${spec.sourceTable}\``);
    }
  } finally {
    await connection.end();
  }
}

async function main() {
  const {
    action = 'create',
    mysqlUrl,
    projectionDb,
    sourceColumnsByTable,
    tableNames,
  } = parseArgs(
    process.argv.slice(2),
  );

  if (!mysqlUrl) {
    throw new Error('mysqlUrl is required.');
  }

  if (!projectionDb) {
    throw new Error('projectionDb is required.');
  }

  if (action === 'create') {
    await createProjectionDatabase(mysqlUrl, projectionDb);
    return;
  }

  if (action === 'drop') {
    await dropProjectionDatabase(mysqlUrl, projectionDb);
    return;
  }

  if (action === 'create-tables') {
    await createProjectionTables(mysqlUrl, projectionDb, sourceColumnsByTable, tableNames);
    return;
  }

  if (action === 'drop-views') {
    await dropMaterializedViews(mysqlUrl);
    return;
  }

  throw new Error(`Unsupported action: ${action}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
