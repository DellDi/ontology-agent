package com.dip3.ontologyagent.easyv.internal.application;

import java.util.Map;

/** 正式 EasyV 精确原型动作接口,与只读采集连接隔离。 */
public interface EasyVBlockActionPort {
  Map<String,Object> prepare(Map<String,Object> plan, String userId, String spaceId, String teamId);
  Map<String,Object> apply(Map<String,Object> prepared, String userId, String spaceId, String teamId);
}
