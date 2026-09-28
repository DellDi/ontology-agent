const fs = require('node:fs');
const path = require('node:path');

// 本体生成的 Cube 访问策略（CubeModelGenerator 产出）：cubeName → {productKey, requiredMembers, scopeMembers}。
const accessPolicy = JSON.parse(fs.readFileSync(path.join(__dirname, 'semantic-access-policy.json'), 'utf8'));
const VERSION_MEMBER = 'productVersionId';
const SCOPE_MODES = new Set(['all', 'scoped']);

function filterMembers(filters) {
  return (filters || []).flatMap((filter) => {
    if (filter.and) return filterMembers(filter.and);
    if (filter.or) return filterMembers(filter.or);
    return filter.member ? [filter.member] : [];
  });
}

function referencedMembers(query) {
  return [
    ...(query.measures || []),
    ...(query.dimensions || []),
    ...(query.segments || []),
    ...(query.timeDimensions || []).map((item) => item.dimension),
    ...filterMembers(query.filters),
    ...(Array.isArray(query.order) ? query.order.map((item) => item[0]) : Object.keys(query.order || {})),
  ];
}

const cubeOf = (member) => member.split('.')[0];

function reject(code, message) {
  throw new Error(`${code}: ${message}`);
}

// 授权范围：mode=all 不限定；mode=scoped 时 values 为 维度 → 允许值，每个被引用 Cube 必须声明全部维度。
function requireScope(securityContext) {
  const scope = securityContext && securityContext.scope;
  if (!scope || !SCOPE_MODES.has(scope.mode)) {
    reject('SEMANTIC_SCOPE_REQUIRED', '缺少授权范围上下文');
  }
  if (scope.mode === 'all') return { mode: 'all', values: {} };
  const values = scope.values || {};
  const dimensions = Object.keys(values);
  if (dimensions.length === 0
    || dimensions.some((key) => !Array.isArray(values[key]) || values[key].length === 0
      || values[key].some((value) => typeof value !== 'string' || value.length === 0))) {
    reject('SEMANTIC_SCOPE_REQUIRED', '限定授权范围缺少有效取值');
  }
  return { mode: 'scoped', values };
}

// 服务端强制注入：成员资格关联、授权范围与冻结数据版本；缺少上下文即拒绝，调用方不能自行引用版本维度。
function queryRewrite(query, { securityContext } = {}) {
  const members = referencedMembers(query);
  const referenced = new Set(members.map(cubeOf).filter((cube) => Object.hasOwn(accessPolicy, cube)));
  if (referenced.size === 0) return query;
  if (members.some((member) => Object.hasOwn(accessPolicy, cubeOf(member)) && member.endsWith(`.${VERSION_MEMBER}`))) {
    reject('SEMANTIC_VERSION_MEMBER_FORBIDDEN', '版本维度只能由服务端注入');
  }
  const scope = requireScope(securityContext);
  const injected = [];
  const processed = new Set();
  const pending = [...referenced].sort();
  while (pending.length > 0) {
    const cube = pending.shift();
    if (processed.has(cube)) continue;
    processed.add(cube);
    const policy = accessPolicy[cube];
    const added = [];
    for (const member of policy.requiredMembers) {
      added.push({ member, operator: 'set' });
    }
    if (scope.mode === 'scoped') {
      for (const [dimension, values] of Object.entries(scope.values).sort(([a], [b]) => a.localeCompare(b))) {
        const member = policy.scopeMembers[dimension];
        if (!member) reject('SEMANTIC_SCOPE_UNSUPPORTED', `${cube} 未声明授权范围维度 ${dimension}`);
        added.push({ member, operator: 'equals', values: [...values] });
      }
    }
    for (const filter of added) {
      injected.push(filter);
      const target = cubeOf(filter.member);
      if (Object.hasOwn(accessPolicy, target) && !processed.has(target)) pending.push(target);
    }
  }
  const versions = (securityContext && securityContext.productVersions) || {};
  const versionFilters = [...processed].sort().map((cube) => {
    const productKey = accessPolicy[cube].productKey;
    const version = versions[productKey];
    if (typeof version !== 'string' || version.length === 0) {
      reject('SEMANTIC_VERSION_REQUIRED', `${cube} 缺少冻结数据版本 ${productKey}`);
    }
    return { member: `${cube}.${VERSION_MEMBER}`, operator: 'equals', values: [version] };
  });
  const unique = [];
  const seen = new Set();
  for (const filter of [...injected, ...versionFilters]) {
    const key = JSON.stringify(filter);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(filter);
    }
  }
  return { ...query, filters: [...(query.filters || []), ...unique] };
}

module.exports = {
  scheduledRefreshContexts: () => [],
  queryRewrite,
};
