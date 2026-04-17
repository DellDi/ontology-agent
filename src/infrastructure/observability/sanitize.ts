/**
 * 日志/可观测性字段脱敏。
 *
 * Story 7.4 AC：避免日志泄露 cookie、token、原始敏感问题文本。
 *
 * 设计原则：
 * - 白名单语义：不认识的字段保留值，但对敏感键名固定脱敏。
 * - 嵌套递归：对象与数组都递归处理，防止深层字段漏掉。
 * - 字符串截断：原始自由文本（例如 question / prompt）默认只保留长度摘要，
 *   业务如需完整记录应走专门的 audit 管道（Story 7.2）。
 */

// Key 匹配同时兼容 snake_case / kebab-case / camelCase 边界：
// 前置边界 (^|_|-)，后置边界 ($|_|-|[A-Z]) 使得 sessionId / apiKey 等字段也能命中。
// 仅匹配高信号敏感字段。`key` 单独匹配过度激进（会波及 publicKey / workflowKey
// 等业务字段），本轮移除；通过 apiKey / accessToken 等精确规则已覆盖真实密钥语义。
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /(^|_|-)(password|passwd|pwd)($|_|-|[A-Z])/,
  /(^|_|-)(token|secret|credential|cred)($|_|-|[A-Z])/i,
  /(^|_|-)(cookie|session|auth)($|_|-|[A-Z])/i,
  /(^|_|-)(api[-_]?key|access[-_]?token|refresh[-_]?token)($|_|-|[A-Z])/i,
];

const QUESTION_KEY_PATTERNS: RegExp[] = [
  /(^|_|-)(questionText|question_text|rawQuestion|raw_question|prompt)($|_|-|[A-Z])/i,
];

const SENSITIVE_PLACEHOLDER = '[REDACTED]';
const QUESTION_PLACEHOLDER_PREFIX = '[QUESTION length=';

const MAX_DEPTH = 6;

export type SanitizeOptions = {
  maxDepth?: number;
};

function matchAny(patterns: RegExp[], key: string) {
  return patterns.some((pattern) => pattern.test(key));
}

function sanitizeQuestionValue(value: unknown): string {
  if (typeof value !== 'string') {
    return SENSITIVE_PLACEHOLDER;
  }
  return `${QUESTION_PLACEHOLDER_PREFIX}${value.length}]`;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  maxDepth: number,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > maxDepth) {
    return '[DEPTH_LIMIT]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, maxDepth));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as object)) {
      if (matchAny(SENSITIVE_KEY_PATTERNS, key)) {
        result[key] = SENSITIVE_PLACEHOLDER;
        continue;
      }
      if (matchAny(QUESTION_KEY_PATTERNS, key)) {
        result[key] = sanitizeQuestionValue(entryValue);
        continue;
      }
      result[key] = sanitizeValue(entryValue, depth + 1, maxDepth);
    }
    return result;
  }

  return String(value);
}

export function sanitizeLogPayload<T>(
  payload: T,
  options: SanitizeOptions = {},
): T {
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  return sanitizeValue(payload, 0, maxDepth) as T;
}

/** 测试暴露：让测试断言某条 key 模式被识别 */
export const __internal = {
  SENSITIVE_KEY_PATTERNS,
  QUESTION_KEY_PATTERNS,
  SENSITIVE_PLACEHOLDER,
  QUESTION_PLACEHOLDER_PREFIX,
};
