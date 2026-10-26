/** Java 开放对象读取、选择与统计下钻的对象目录；与共享契约的对象枚举保持一致。 */
export const readableObjectKeys = [
  'easyv-ai-application', 'easyv-prototype-layout', 'easyv-prototype-block', 'easyv-prototype-component',
  'easyv-generation-feedback', 'easyv-quality-node', 'easyv-forge-task',
] as const;
export type ReadableObjectKey = (typeof readableObjectKeys)[number];

/** 用户显式选中的当前已发布对象；属性与权限由 Java 重新读取。 */
export type AnalysisObjectSelection = {
  additionalReferences?: AnalysisObjectSelection['reference'][];
  executionId: string;
  datasetVersionSetId: string;
  reference: {
    objectKey: ReadableObjectKey;
    objectId: string;
    productVersionId: string;
  };
};

/** 来源执行可以续接，但整批对象及冻结集合必须保持一致。 */
export function sameObjectSelectionScope(a: AnalysisObjectSelection, b: AnalysisObjectSelection): boolean {
  const references = (selection: AnalysisObjectSelection) => [selection.reference, ...(selection.additionalReferences ?? [])]
    .map(reference => JSON.stringify([reference.objectKey, reference.objectId, reference.productVersionId])).sort();
  return a.datasetVersionSetId === b.datasetVersionSetId && JSON.stringify(references(a)) === JSON.stringify(references(b));
}
