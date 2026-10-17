package com.dip3.ontologyagent.easyv.internal.application;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
public interface EasyVBlockActionStore {
  record Action(String id,String sessionId,String invocationId,String owner,String status,Map<String,Object> prepared,
                Map<String,Object> result,String error,Instant updatedAt) {}
  Action create(String session,String invocation,String owner,Map<String,Object> prepared);
  Optional<Action> latest(String session,String invocation,String owner);
  Action require(String id,String session,String owner);
  boolean claim(String id);
  void finish(String id,String status,Map<String,Object> result,String error);
}
