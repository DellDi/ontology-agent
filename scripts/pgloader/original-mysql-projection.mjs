import mysql from 'mysql2/promise';
import {
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
  const { action = 'create', mysqlUrl, projectionDb } = parseArgs(
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
