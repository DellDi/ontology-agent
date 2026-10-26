export const dataNames: Record<string, string> = {
  easyv: 'EasyV 业务数据', property: '物业业务数据',
  'easyv-ai-application': '大屏应用', 'easyv-prototype-task': '原型生成任务',
  'easyv-prototype-layout': '原型布局', 'easyv-prototype-block': '原型区块',
  'easyv-prototype-component': '原型组件', 'easyv-scheme-library': '方案库',
  'easyv-pipeline-node': '生成流程节点', 'easyv-forge-task': '页面生成任务',
  'easyv-generation-feedback': '生成反馈', 'property-project': '物业项目',
  'property-charge-item': '收费项目', 'property-receivable': '应收记录', 'property-payment': '缴费记录',
  'easyv-block-scheme': '区块方案', 'easyv-slot-type': '方案槽位类型',
  'property-organization': '物业组织', 'property-service-order': '服务工单',
};

export function dataName(key: string) {
  return dataNames[key] ?? key;
}

export function updateFailureMessage(code: string | null) {
  switch (code) {
    case 'SOURCE_CONNECTION_FAILED':
      return '数据源连接失败，请检查连接配置与网络。';
    case 'SOURCE_CONNECTION_RESOLUTION_FAILED':
      return '未能获取数据源连接，请检查连接配置。';
    case 'PRODUCT_MATERIALIZATION_FAILED':
      return '分析数据整理失败，请查看诊断信息并修复后重新执行。';
    case 'INGESTION_RELEASE_INTERRUPTED':
      return '数据更新执行中断，请查看运行记录后重新执行。';
    default:
      return '数据更新未完成，请查看诊断信息，确认原因并修复后重新执行。';
  }
}

export const dataGroups = [
  { name: '大屏与原型', keys: ['easyv-ai-application', 'easyv-prototype-task', 'easyv-prototype-layout', 'easyv-prototype-block', 'easyv-prototype-component'] },
  { name: '生成过程与反馈', keys: ['easyv-forge-task', 'easyv-pipeline-node', 'easyv-generation-feedback'] },
  { name: '可复用方案', keys: ['easyv-scheme-library'] },
  { name: '物业收费', keys: ['property-project', 'property-charge-item', 'property-receivable', 'property-payment'] },
];
