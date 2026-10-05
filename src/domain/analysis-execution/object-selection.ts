/** 用户显式选中的已冻结对象；属性与权限由 Java 重新读取。 */
export type AnalysisObjectSelection = {
  executionId: string;
  datasetVersionSetId: string;
  reference: {
    objectKey: 'easyv-prototype-layout' | 'easyv-prototype-block' | 'easyv-prototype-component';
    objectId: string;
    productVersionId: string;
  };
};
