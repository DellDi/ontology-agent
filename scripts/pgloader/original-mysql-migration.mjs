import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  buildMaterializedMysqlViewDefinition,
  getOriginalMysqlSourceTableNames,
  originalMysqlTableSpecs,
} from './original-mysql-specs.mjs';

function buildTableMatchList() {
  return getOriginalMysqlSourceTableNames()
    .map((tableName) => `'${tableName}'`)
    .join(', ');
}

export function buildOriginalMysqlPgloaderLoad({
  mysqlUrl,
  postgresUrl,
  materializeSourceDatabase,
  tableNames,
  sourceColumnsByTable,
}) {
  if (!mysqlUrl) {
    throw new Error('mysqlUrl is required.');
  }

  if (!postgresUrl) {
    throw new Error('postgresUrl is required.');
  }

  const allowedTableNames = Array.isArray(tableNames) && tableNames.length > 0
    ? new Set(tableNames)
    : sourceColumnsByTable
      ? new Set(Object.keys(sourceColumnsByTable))
      : null;
  const selectedSpecs = (allowedTableNames
    ? originalMysqlTableSpecs.filter((spec) => allowedTableNames.has(spec.sourceTable))
    : originalMysqlTableSpecs)
    .map((spec) => {
      const availableColumns = sourceColumnsByTable?.[spec.sourceTable];
      if (!Array.isArray(availableColumns) || availableColumns.length === 0) {
        return spec;
      }

      const filteredColumns = spec.columns.filter(([sourceColumn]) => availableColumns.includes(sourceColumn));
      return {
        ...spec,
        columns: filteredColumns,
      };
    })
    .filter((spec) => spec.columns.length > 0);
  const sourceDatabase = decodeURIComponent(
    new URL(mysqlUrl).pathname.replace(/^\/+/, ''),
  );
  const materializeDatabase = materializeSourceDatabase ?? sourceDatabase;
  const materializedViews = selectedSpecs
    .map((spec) => `     ${buildMaterializedMysqlViewDefinition(spec, materializeDatabase)}`)
    .join(',\n');
  const materializeViewsClause = materializedViews
    ? `     MATERIALIZE VIEWS\n${materializedViews},\n`
    : '';
  const includeTablesClause = materializeSourceDatabase
    ? ''
    : `     INCLUDING ONLY TABLE NAMES MATCHING ${selectedSpecs.length > 0
      ? selectedSpecs.map((spec) => `'${spec.sourceTable}'`).join(', ')
      : buildTableMatchList()}\n`;

  return `LOAD DATABASE
     FROM ${mysqlUrl}
     INTO ${postgresUrl}

 WITH include no drop, create no tables, foreign keys, reset sequences, downcase identifiers, preserve index names,
      workers = 1, concurrency = 1

${materializeViewsClause}${includeTablesClause}

 ALTER SCHEMA '${sourceDatabase}' RENAME TO 'erp_staging'

 SET MySQL PARAMETERS
     net_read_timeout = '7200',
     net_write_timeout = '7200'

 SET PostgreSQL PARAMETERS
     search_path to 'erp_staging, public'

 BEFORE LOAD DO
     $$ create schema if not exists erp_staging; $$;
`;
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--mysql-url') {
      args.mysqlUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--postgres-url') {
      args.postgresUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--materialize-source-database') {
      args.materializeSourceDatabase = argv[index + 1];
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
  }

  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mysqlUrl, postgresUrl, materializeSourceDatabase } = parseArgs(
    process.argv.slice(2),
  );
  const { tableNames, sourceColumnsByTable } = parseArgs(process.argv.slice(2));
  process.stdout.write(
    `${buildOriginalMysqlPgloaderLoad({ mysqlUrl, postgresUrl, materializeSourceDatabase, tableNames, sourceColumnsByTable })}\n`,
  );
}
