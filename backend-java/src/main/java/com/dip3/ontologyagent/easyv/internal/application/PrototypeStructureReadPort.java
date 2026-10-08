package com.dip3.ontologyagent.easyv.internal.application;

import java.util.Map;
import java.util.List;

/** 仅在对象已通过冻结集合与范围校验后读取其布局文档；旧版未保留时返回 null。 */
public interface PrototypeStructureReadPort {
  Map<String, Object> structure(String productVersionId, String appId);
  /** 仅查询已经通过对象权限检查的当前分页组件；key 是完整组件对象 ID。 */
  Map<String, Map<String, Object>> componentGeometry(String productVersionId, List<String> objectIds);
}
