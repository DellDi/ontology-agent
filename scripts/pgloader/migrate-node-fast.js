const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { performance } = require('perf_hooks');

// 从环境变量获取配置 mysql -u b9d73f86-2233-492d-bfe3-ee7d92e78f1f -gHK1csA1qhRv8inF -h jms.new-see.com -P 33061 
const MYSQL_URL = process.env.MYSQL_URL || 'mysql://b9d73f86-2233-492d-bfe3-ee7d92e78f1f:gHK1csA1qhRv8inF@jms.new-see.com:33061/newsee-datacenter';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const PROJECTION_DB = process.env.PROJECTION_DB; // 不设置默认值，使用 MYSQL_URL 中的数据库

const tableNames = [
  'dw_datacenter_system_user',
  'dw_datacenter_system_organization',
  'dw_datacenter_precinct',
  'dw_datacenter_owner',
  'dw_datacenter_chargeitem',
  'dw_datacenter_charge',
  'dw_datacenter_bill',
  'dw_datacenter_services',
  'dw_datacenter_house',
];

// 列名映射：MySQL列名 -> PostgreSQL列名（null表示跳过该列）
const columnMappings = {
  'dw_datacenter_precinct': { 
    'id': 'record_id', 
    'serviceWork': null,
    'zdyScopeOfServices': null,
    'zdyScopeOfServicesCode': null,
    'zdyScopeOfServicesName': null,
    'zdyIsItAKeyProject': null,
    'zdyProjectType': null,
    'zdyProjectTypeName': null,
    'zdyTotalEmployment': null,
    'zdyTotalNumberOfUsers': null,
    'zdyBreakfastDiningStandards': null,
    'zdyLunchMealStandards': null,
    'zdyDinnerDiningStandards': null,
  },
  'dw_datacenter_owner': { 'id': 'record_id' },
  'dw_datacenter_chargeitem': { 'id': 'record_id' },
  'dw_datacenter_charge': { 'id': 'record_id', 'DBID': 'db_id' },
  'dw_datacenter_bill': { 'id': 'record_id', 'DBID': 'db_id' },
  'dw_datacenter_services': { 'id': 'record_id' },
  'dw_datacenter_house': { 'id': 'record_id' },
};

console.log('=== 优化版 Node.js 迁移（批量插入） ===');
console.log(`源: MySQL (${MYSQL_URL})`);
console.log(`目标: PostgreSQL (${DATABASE_URL})`);
console.log(`表数: ${tableNames.length}`);
console.log('');

// 性能配置
const BATCH_SIZE = 5000;        // 增大读取批次
const INSERT_BATCH_SIZE = 500;  // 每批插入行数（避免 SQL 过长）

function toSnakeCase(str, tableName) {
  // 先应用列名映射
  if (tableName && columnMappings[tableName] && columnMappings[tableName].hasOwnProperty(str)) {
    return columnMappings[tableName][str]; // 可能是映射值或 null
  }
  
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')  // 在小写后的大写字母前加下划线
    .replace(/([0-9])([A-Z])/g, '$1_$2')  // 在数字后的大写字母前加下划线
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // 在连续大写后的第一个小写字母前加下划线
    .toLowerCase();
}

function cleanValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) return val.toString('base64');
  return val;
}

// 批量插入 - 使用多值 INSERT
async function batchInsert(pgClient, tableName, columnNames, pgColumnNames, rows) {
  if (rows.length === 0) return;

  const insertColumns = pgColumnNames.join(', ');
  const valuesPlaceholders = [];
  const values = [];
  let paramIndex = 1;

  for (const row of rows) {
    const rowPlaceholders = [];
    for (const col of columnNames) {
      values.push(cleanValue(row[col]));
      rowPlaceholders.push('$' + paramIndex++);
    }
    valuesPlaceholders.push('(' + rowPlaceholders.join(', ') + ')');
  }

  const sql = `INSERT INTO erp_staging.${tableName} (${insertColumns}) VALUES ${valuesPlaceholders.join(', ')} ON CONFLICT DO NOTHING`;
  await pgClient.query(sql, values);
}

async function migrateTable(tableName, mysqlConn, pgClient) {
  const startTime = performance.now();

  // 1. 获取表结构
  const [columns] = await mysqlConn.query('SHOW COLUMNS FROM ??', [tableName]);
  const columnNames = columns.map(c => c.Field);
  const pgColumnNames = columnNames.map(col => toSnakeCase(col, tableName));
  
  // 过滤掉映射为 null 的列（跳过的列）
  const validColumns = columns.filter(c => {
    const pgName = toSnakeCase(c.Field, tableName);
    return pgName !== null;
  });
  const validColumnNames = validColumns.map(c => c.Field);
  const validPgColumnNames = validColumnNames.map(col => toSnakeCase(col, tableName));

  // 2. 统计行数
  const [[{ count }]] = await mysqlConn.query('SELECT COUNT(*) as count FROM ??', [tableName]);
  console.log(`\n[${tableName}] 列数: ${columnNames.length}, 行数: ${count}`);

  if (count === 0) {
    return { tableName, count: 0, duration: 0 };
  }

  // 3. 假设表已存在，不修改表结构

  // 4. 分批读取 + 批量插入
  let processed = 0;
  let batchBuffer = [];

  for (let offset = 0; offset < count; offset += BATCH_SIZE) {
    const [rows] = await mysqlConn.query(
      'SELECT * FROM ?? LIMIT ? OFFSET ?', [tableName, BATCH_SIZE, offset]
    );

    if (rows.length === 0) break;

    // 累积到批处理缓冲区
    batchBuffer.push(...rows);

    // 当缓冲区达到 INSERT_BATCH_SIZE 时执行批量插入
    while (batchBuffer.length >= INSERT_BATCH_SIZE) {
      const insertBatch = batchBuffer.splice(0, INSERT_BATCH_SIZE);
      await batchInsert(pgClient, tableName, validColumnNames, validPgColumnNames, insertBatch);
    }

    processed += rows.length;
    if (processed % 10000 === 0 || processed === count) {
      const percent = ((processed / count) * 100).toFixed(1);
      process.stdout.write(`\r[${tableName}] ${percent}% (${processed}/${count})`);
    }
  }

  // 插入剩余数据
  if (batchBuffer.length > 0) {
    await batchInsert(pgClient, tableName, validColumnNames, validPgColumnNames, batchBuffer);
    batchBuffer = [];
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  const rps = (count / parseFloat(duration)).toFixed(0);
  console.log(`\n[${tableName}] 完成: ${count} 行, ${duration}s (${rps} 行/秒)`);

  return { tableName, count, duration: parseFloat(duration), rps: parseInt(rps) };
}

async function main() {
  const startTime = performance.now();

  // 连接
  const mysqlUrl = new URL(MYSQL_URL);
  const pgUrl = new URL(DATABASE_URL);

  const mysqlConn = await mysql.createConnection({
    host: mysqlUrl.hostname,
    port: mysqlUrl.port ? Number(mysqlUrl.port) : 3306,
    user: decodeURIComponent(mysqlUrl.username),
    password: decodeURIComponent(mysqlUrl.password),
    database: process.env.PROJECTION_DB || mysqlUrl.pathname.replace(/^\/+/, ''),
  });

  const pgClient = new Client({
    host: pgUrl.hostname,
    port: pgUrl.port ? Number(pgUrl.port) : 5432,
    user: decodeURIComponent(pgUrl.username),
    password: decodeURIComponent(pgUrl.password),
    database: pgUrl.pathname.replace(/^\/+/, ''),
  });
  await pgClient.connect();

  await pgClient.query('CREATE SCHEMA IF NOT EXISTS erp_staging');

  console.log('连接成功，开始迁移...');
  console.log(`配置: 读取批次=${BATCH_SIZE}, 插入批次=${INSERT_BATCH_SIZE}`);

  // 串行迁移
  const results = [];
  for (const tableName of tableNames) {
    try {
      const result = await migrateTable(tableName, mysqlConn, pgClient);
      results.push(result);
    } catch (err) {
      console.error(`[${tableName}] 错误: ${err.message}`);
      results.push({ tableName, count: 0, duration: 0, error: err.message });
    }
  }

  await mysqlConn.end();
  await pgClient.end();

  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
  const totalRows = results.reduce((sum, r) => sum + (r.count || 0), 0);
  const avgRps = (totalRows / parseFloat(totalDuration)).toFixed(0);

  console.log('\n=== 迁移汇总 ===');
  console.log(`总表数: ${results.length}`);
  console.log(`总行数: ${totalRows}`);
  console.log(`总耗时: ${totalDuration}s`);
  console.log(`平均速度: ${avgRps} 行/秒`);
  console.log('\n各表详情:');
  results.forEach(r => {
    const status = r.error ? '❌' : '✅';
    const speed = r.rps ? ` (${r.rps} 行/秒)` : '';
    console.log(`  ${status} ${r.tableName}: ${r.count} 行 (${r.duration}s)${speed}`);
  });
}

main().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
