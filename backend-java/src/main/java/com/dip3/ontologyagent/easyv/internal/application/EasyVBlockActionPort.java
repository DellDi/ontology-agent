package com.dip3.ontologyagent.easyv.internal.application;

import java.util.Map;

/** EasyV 精确动作执行端口：工具与管理入口复用应用服务；传输实现不进入提案/确认契约。 */
public interface EasyVBlockActionPort {
  Map<String,Object> prepare(Map<String,Object> plan, String userId, String spaceId, String teamId);
  Map<String,Object> apply(Map<String,Object> prepared, String userId, String spaceId, String teamId);
}
