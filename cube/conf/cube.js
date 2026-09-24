const fs = require('node:fs');
const path = require('node:path');

// 本体生成的 Cube → 数据产品（CubeModelGenerator 产出）。这些 Cube 必须绑定调用方冻结的数据版本。
const versionedCubes = JSON.parse(fs.readFileSync(path.join(__dirname, 'versioned-cubes.json'), 'utf8'));
const VERSION_MEMBER = 'productVersionId';

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

// 版本强制绑定：由服务端注入，缺少上下文即拒绝；调用方不能自行引用版本维度。
function queryRewrite(query, { securityContext } = {}) {
  const members = referencedMembers(query);
  const managed = [...new Set(members.map((member) => member.split('.')[0]))]
    .filter((cube) => Object.hasOwn(versionedCubes, cube))
    .sort();
  if (managed.length === 0) return query;
  if (members.some((member) => managed.includes(member.split('.')[0]) && member.endsWith(`.${VERSION_MEMBER}`))) {
    throw new Error('SEMANTIC_VERSION_MEMBER_FORBIDDEN: 版本维度只能由服务端注入');
  }
  const versions = (securityContext && securityContext.productVersions) || {};
  const filters = managed.map((cube) => {
    const version = versions[versionedCubes[cube]];
    if (typeof version !== 'string' || version.length === 0) {
      throw new Error(`SEMANTIC_VERSION_REQUIRED: ${cube} 缺少冻结数据版本 ${versionedCubes[cube]}`);
    }
    return { member: `${cube}.${VERSION_MEMBER}`, operator: 'equals', values: [version] };
  });
  return { ...query, filters: [...(query.filters || []), ...filters] };
}

module.exports = {
  scheduledRefreshContexts: () => [],
  queryRewrite,
};
