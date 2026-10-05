package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.support.BackendException;
import java.util.Map;
import java.util.Set;

/** 用户从真实对象响应选中的引用；不接受属性、权限或 SQL。 */
public record ObjectSelection(String executionId, String datasetVersionSetId, ObjectQueryPort.Reference reference) {
  public ObjectSelection {
    text(executionId); text(datasetVersionSetId);
    if (reference == null) throw invalid();
    text(reference.objectKey()); text(reference.objectId()); text(reference.productVersionId());
  }

  public Map<String, Object> snapshot() {
    return Map.of("executionId", executionId, "datasetVersionSetId", datasetVersionSetId,
        "reference", Map.of("objectKey", reference.objectKey(), "objectId", reference.objectId(),
            "productVersionId", reference.productVersionId()));
  }

  public static ObjectSelection read(Object raw) {
    if (!(raw instanceof Map<?, ?> map) || !map.keySet().equals(Set.of("executionId", "datasetVersionSetId", "reference"))
        || !(map.get("reference") instanceof Map<?, ?> ref)
        || !ref.keySet().equals(Set.of("objectKey", "objectId", "productVersionId"))) throw invalid();
    return new ObjectSelection(text(map.get("executionId")), text(map.get("datasetVersionSetId")),
        new ObjectQueryPort.Reference(text(ref.get("objectKey")), text(ref.get("objectId")), text(ref.get("productVersionId"))));
  }

  private static String text(Object value) {
    if (!(value instanceof String text) || text.isBlank() || text.length() > 500) throw invalid();
    return text;
  }
  private static BackendException invalid() {
    return new BackendException("OBJECT_SELECTION_INVALID", "对象选择必须包含来源执行、冻结集合与完整对象引用，不能指定属性或权限。");
  }
}
