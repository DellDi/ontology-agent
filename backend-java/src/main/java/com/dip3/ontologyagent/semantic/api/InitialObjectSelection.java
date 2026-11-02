package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.support.BackendException;
import java.util.*;

/** 目录发起的对象范围，尚无来源执行；真正执行时才绑定执行 ID。 */
public record InitialObjectSelection(String datasetVersionSetId, List<ObjectQueryPort.Reference> references) {
  public InitialObjectSelection {
    if (datasetVersionSetId == null || datasetVersionSetId.isBlank() || datasetVersionSetId.length() > 500
        || references == null || references.isEmpty() || references.size() > 3) throw invalid();
    if (references.stream().anyMatch(Objects::isNull)) throw invalid();
    references = List.copyOf(references);
    var ids = new HashSet<String>();
    for (var ref : references) {
      if (ref == null || ref.objectKey() == null || ref.objectKey().isBlank() || ref.objectKey().length() > 500
          || !references.getFirst().objectKey().equals(ref.objectKey())
          || ref.objectId() == null || ref.objectId().isBlank() || ref.objectId().length() > 500
          || ref.productVersionId() == null || ref.productVersionId().isBlank() || ref.productVersionId().length() > 500
          || !references.getFirst().productVersionId().equals(ref.productVersionId()) || !ids.add(ref.objectId())) throw invalid();
    }
  }

  public ObjectSelection bind(String executionId) {
    return new ObjectSelection(executionId, datasetVersionSetId, references.getFirst(), references.subList(1, references.size()));
  }

  public Map<String, Object> snapshot() {
    return Map.of("datasetVersionSetId", datasetVersionSetId, "references", references.stream().map(ref ->
        Map.of("objectKey", ref.objectKey(), "objectId", ref.objectId(), "productVersionId", ref.productVersionId())).toList());
  }

  public static InitialObjectSelection read(Object raw) {
    if (!(raw instanceof Map<?, ?> map) || !map.keySet().equals(Set.of("datasetVersionSetId", "references"))
        || !(map.get("datasetVersionSetId") instanceof String version) || !(map.get("references") instanceof List<?> rows)) throw invalid();
    var refs = new ArrayList<ObjectQueryPort.Reference>();
    for (var row : rows) {
      if (!(row instanceof Map<?, ?> ref) || !ref.keySet().equals(Set.of("objectKey", "objectId", "productVersionId"))
          || !(ref.get("objectKey") instanceof String key) || !(ref.get("objectId") instanceof String id)
          || !(ref.get("productVersionId") instanceof String product)) throw invalid();
      refs.add(new ObjectQueryPort.Reference(key, id, product));
    }
    return new InitialObjectSelection(version, refs);
  }

  private static BackendException invalid() {
    return new BackendException("OBJECT_SELECTION_INVALID", "请选择同一冻结集合、同一产品版本下的 1–3 张不同大屏；不能指定执行、属性或权限。");
  }
}
