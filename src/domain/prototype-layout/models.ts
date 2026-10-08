/** Java 保留的结构树。展示端不解析 XML，也不补造缺失的页面尺寸。 */
export type PrototypeLayoutNode = {
  tag: string;
  attributes: Record<string, string>;
  children: PrototypeLayoutNode[];
};

/** 冻结事实保留的源组件百分比外框；缺失与非法位置不能视作可展示。 */
export type PrototypeComponentGeometry =
  | { status: 'available'; errorCode: null; box: { x: number; y: number; width: number; height: number } }
  | { status: 'missing' | 'invalid'; errorCode: string; box: null };
