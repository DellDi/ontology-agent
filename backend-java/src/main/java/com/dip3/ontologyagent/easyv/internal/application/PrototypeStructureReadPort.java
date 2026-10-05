package com.dip3.ontologyagent.easyv.internal.application;

import java.util.Map;

/** 仅在对象已通过冻结集合与范围校验后读取其布局文档；旧版未保留时返回 null。 */
public interface PrototypeStructureReadPort {
  Map<String, Object> structure(String productVersionId, String appId);
}
