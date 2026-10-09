/** Java 开放对象读取、选择与统计下钻的对象目录；与共享契约的对象枚举保持一致。 */
export const readableObjectKeys = [
  'easyv-ai-application', 'easyv-prototype-layout', 'easyv-prototype-block', 'easyv-prototype-component',
] as const;
export type ReadableObjectKey = (typeof readableObjectKeys)[number];

/** 用户显式选中的已冻结对象；属性与权限由 Java 重新读取。 */
export type AnalysisObjectSelection = {
  executionId: string;
  datasetVersionSetId: string;
  reference: {
    objectKey: ReadableObjectKey;
    objectId: string;
    productVersionId: string;
  };
};
