export type ProjectEntityCatalogItem = {
  id: string;
  name: string;
  code?: string | null;
};

export type ProjectEntityResolutionIssue = {
  value: string;
  reason: 'unmatched' | 'ambiguous' | 'empty-catalog';
  candidates?: ProjectEntityCatalogItem[];
};

export type ProjectEntityResolution = {
  projectIds: string[];
  projectNames: string[];
  issues: ProjectEntityResolutionIssue[];
};

const INTENT_WORDS = [
  '帮我',
  '帮忙',
  '麻烦',
  '请问',
  '请',
  '查看一下',
  '看一下',
  '查一下',
  '分析一下',
  '查看',
  '看看',
  '看下',
  '查下',
  '分析',
  '一下',
  '一下子',
  '给我',
];

const METRIC_AND_TIME_WORDS = [
  '近三个月',
  '最近三个月',
  '本季度',
  '本月',
  '上月',
  '今年',
  '本年',
  '去年',
  '收缴率',
  '收费回款率',
  '回款率',
  '回款表现',
  '回款金额',
  '收费率',
  '欠费压力',
  '欠费',
  '投诉量',
  '投诉率',
  '满意度评分',
  '满意度',
  '工单完工率',
  '工单超时率',
  '物业费',
  '情况',
  '数据',
  '表现',
  '特点',
  '原因',
];

const PROJECT_SUFFIX_PATTERNS = [
  /项目$/u,
  /小区$/u,
  /办公楼$/u,
  /员工餐厅$/u,
  /智慧餐厅$/u,
  /餐饮项目$/u,
  /物业服务项目$/u,
  /物业项目$/u,
];

const CONFUSABLE_CHAR_MAP: Record<string, string> = {
  坑: '炕',
};

function normalizeConfusableChars(value: string) {
  return [...value].map((char) => CONFUSABLE_CHAR_MAP[char] ?? char).join('');
}

export function normalizeProjectEntityText(value: string) {
  let normalized = normalizeConfusableChars(value)
    .toLowerCase()
    .replace(/[()\[\]{}（）【】《》"'“”‘’]/gu, '')
    .replace(/[\s\t\r\n，,。；;：:？?！!、/\\|_-]+/gu, '');

  for (const word of [...INTENT_WORDS, ...METRIC_AND_TIME_WORDS]) {
    normalized = normalized.replaceAll(word, '');
  }

  normalized = normalized
    .replace(/(?:19|20)\d{2}年?/gu, '')
    .replace(/第?[一二三四五六七八九十\d]+季度/gu, '')
    .replace(/[的地得]/gu, '')
    .trim();

  for (const pattern of PROJECT_SUFFIX_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }

  return normalized.trim();
}

function buildProjectAliases(project: ProjectEntityCatalogItem) {
  const aliases = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = value ? normalizeProjectEntityText(value) : '';
    if (normalized.length >= 2) {
      aliases.add(normalized);
    }
  };

  add(project.name);
  add(project.code);

  let suffixStripped = project.name;
  for (const pattern of PROJECT_SUFFIX_PATTERNS) {
    suffixStripped = suffixStripped.replace(pattern, '');
    add(suffixStripped);
  }

  return [...aliases];
}

function damerauLevenshteinDistance(left: string, right: string) {
  const a = [...left];
  const b = [...right];
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitutionCost,
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }

  return matrix[a.length][b.length];
}

function characterSetScore(left: string, right: string) {
  const leftChars = new Set([...left]);
  const rightChars = new Set([...right]);
  const union = new Set([...leftChars, ...rightChars]);
  let intersectionSize = 0;

  for (const char of leftChars) {
    if (rightChars.has(char)) {
      intersectionSize += 1;
    }
  }

  return union.size > 0 ? intersectionSize / union.size : 0;
}

function scoreAlias(query: string, alias: string) {
  if (!query || !alias) {
    return 0;
  }

  if (query === alias) {
    return 1;
  }

  if (alias.includes(query) || query.includes(alias)) {
    const shorterLength = Math.min(query.length, alias.length);
    const longerLength = Math.max(query.length, alias.length);
    return 0.86 + (shorterLength / longerLength) * 0.12;
  }

  const distance = damerauLevenshteinDistance(query, alias);
  const editScore = 1 - distance / Math.max(query.length, alias.length);
  const setScore = characterSetScore(query, alias);

  return Math.max(editScore, setScore * 0.9);
}

function minimumScoreFor(query: string) {
  if (query.length <= 2) {
    return 0.82;
  }

  if (query.length <= 4) {
    return 0.58;
  }

  return 0.66;
}

function resolveSingleProjectValue(
  value: string,
  catalog: ProjectEntityCatalogItem[],
) {
  const query = normalizeProjectEntityText(value);

  if (!query) {
    return { matches: [] as ProjectEntityCatalogItem[], ambiguous: false };
  }

  const scored = catalog
    .map((project) => ({
      project,
      score: Math.max(
        ...buildProjectAliases(project).map((alias) => scoreAlias(query, alias)),
        0,
      ),
    }))
    .filter((item) => item.score >= minimumScoreFor(query))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { matches: [] as ProjectEntityCatalogItem[], ambiguous: false };
  }

  const topScore = scored[0].score;
  const topMatches = scored
    .filter((item) => Math.abs(item.score - topScore) <= 0.03)
    .map((item) => item.project);
  const nextDifferentScore = scored.find(
    (item) => Math.abs(item.score - topScore) > 0.03,
  )?.score;

  if (
    topMatches.length === 1 &&
    nextDifferentScore !== undefined &&
    topScore - nextDifferentScore < 0.12
  ) {
    return {
      matches: topMatches,
      ambiguous: true,
      candidates: scored.slice(0, 5).map((item) => item.project),
    };
  }

  return { matches: topMatches, ambiguous: false };
}

export function resolveProjectEntityConstraints({
  values,
  catalog,
}: {
  values: string[];
  catalog: ProjectEntityCatalogItem[];
}): ProjectEntityResolution {
  const projectById = new Map<string, ProjectEntityCatalogItem>();
  const issues: ProjectEntityResolutionIssue[] = [];

  if (values.length > 0 && catalog.length === 0) {
    return {
      projectIds: [],
      projectNames: [],
      issues: values.map((value) => ({
        value,
        reason: 'empty-catalog' as const,
      })),
    };
  }

  for (const value of values) {
    const resolution = resolveSingleProjectValue(value, catalog);

    if (resolution.ambiguous) {
      issues.push({
        value,
        reason: 'ambiguous',
        candidates: resolution.candidates,
      });
      continue;
    }

    if (resolution.matches.length === 0) {
      issues.push({ value, reason: 'unmatched' });
      continue;
    }

    for (const project of resolution.matches) {
      projectById.set(project.id, project);
    }
  }

  const projects = [...projectById.values()];

  return {
    projectIds: projects.map((project) => project.id),
    projectNames: projects.map((project) => project.name),
    issues,
  };
}
