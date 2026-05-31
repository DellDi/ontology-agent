/**
 * Story 12-5: 工具名称翻译映射。
 *
 * 将内部工具标识符翻译为面向业务用户的中文名称，
 * 使聊天界面中的工具活动不以工程术语呈现。
 */

export const TOOL_NAME_TRANSLATIONS: Record<string, string> = {
  'cube.semantic-query': '数据查询',
  'cube.query': '数据查询',
  'neo4j.graph-query': '关系分析',
  'neo4j.query': '关系分析',
  'llm.structured-analysis': '智能分析',
  'llm.analysis': '智能分析',
  'erp-read': '业务数据读取',
  'erp.read-model': '业务数据读取',
  'context-extraction': '上下文提取',
  'plan-generation': '计划生成',
  'platform.capability-status': '平台能力状态',
};

/** 把内部工具名翻译为业务用户可读的中文名称。 */
export function translateToolName(toolName: string): string {
  return TOOL_NAME_TRANSLATIONS[toolName] ?? toolName;
}
