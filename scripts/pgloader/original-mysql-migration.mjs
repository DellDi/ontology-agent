const TABLE_NAMES = [
  'dw_datacenter_system_organization',
  'dw_datacenter_precinct',
  'dw_datacenter_owner',
  'dw_datacenter_chargeitem',
  'dw_datacenter_charge',
  'dw_datacenter_bill',
  'dw_datacenter_services',
  'dw_datacenter_house',
  'dw_datacenter_system_user',
];

export function buildOriginalMysqlPgloaderLoad({
  mysqlUrl,
  postgresUrl,
}) {
  const includingTables = TABLE_NAMES.map((tableName) => `'${tableName}'`).join(', ');

  return `
LOAD DATABASE
  FROM ${mysqlUrl}
  INTO ${postgresUrl}

WITH workers = 1, concurrency = 1, create no tables, foreign keys

SET MySQL PARAMETERS
  net_read_timeout = '7200'

INCLUDING ONLY TABLE NAMES MATCHING ${includingTables};
`.trim();
}

function parseCliArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = value.split('=', 2);

    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }

    args.set(key, argv[index + 1] ?? '');
    index += 1;
  }

  return args;
}

if (process.argv.includes('--run')) {
  const args = parseCliArgs(process.argv.slice(2));
  const mysqlUrl = args.get('--mysql-url') ?? process.env.MYSQL_URL ?? '';
  const postgresUrl =
    args.get('--postgres-url') ?? process.env.DATABASE_URL ?? '';

  if (!mysqlUrl || !postgresUrl) {
    console.error('缺少 --mysql-url 或 --postgres-url / DATABASE_URL。');
    process.exit(1);
  }

  console.log(
    buildOriginalMysqlPgloaderLoad({
      mysqlUrl,
      postgresUrl,
    }),
  );
}

const originalMysqlMigrationModule = {
  buildOriginalMysqlPgloaderLoad,
};

export default originalMysqlMigrationModule;
