/** Java 保留的结构树。展示端不解析 XML，也不补造缺失的页面尺寸。 */
export type PrototypeLayoutNode = {
  tag: string;
  attributes: Record<string, string>;
  children: PrototypeLayoutNode[];
};
