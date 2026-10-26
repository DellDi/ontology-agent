package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.Set;

/** 用户从真实对象响应选中的引用；不接受属性、权限或 SQL。 */
public record ObjectSelection(String executionId, String datasetVersionSetId, ObjectQueryPort.Reference reference, @JsonInclude(JsonInclude.Include.NON_EMPTY) List<ObjectQueryPort.Reference> additionalReferences) {
  public ObjectSelection(String executionId, String datasetVersionSetId, ObjectQueryPort.Reference reference) {
    this(executionId, datasetVersionSetId, reference, List.of());
  }
  public ObjectSelection {
    text(executionId); text(datasetVersionSetId);
    if (reference == null) throw invalid();
    text(reference.objectKey()); text(reference.objectId()); text(reference.productVersionId());
    additionalReferences = additionalReferences == null ? List.of() : List.copyOf(additionalReferences);
    if (additionalReferences.size() > 2) throw invalid();
    var ids = new HashSet<String>(); ids.add(reference.objectId());
    for (var member : additionalReferences) {
      if (member == null || !"easyv-prototype-layout".equals(reference.objectKey())
          || !reference.objectKey().equals(member.objectKey())
          || !reference.productVersionId().equals(member.productVersionId()) || !ids.add(text(member.objectId()))) throw invalid();
    }
  }

  public Map<String, Object> snapshot() {
    var snapshot = new LinkedHashMap<String, Object>();
    snapshot.put("executionId", executionId); snapshot.put("datasetVersionSetId", datasetVersionSetId);
    snapshot.put("reference", referenceMap(reference));
    if (!additionalReferences.isEmpty()) snapshot.put("additionalReferences", additionalReferences.stream().map(ObjectSelection::referenceMap).toList());
    return Map.copyOf(snapshot);
  }

  public List<ObjectQueryPort.Reference> references() {
    var references = new ArrayList<ObjectQueryPort.Reference>(); references.add(reference); references.addAll(additionalReferences);
    return List.copyOf(references);
  }

  public static ObjectSelection read(Object raw) {
    if (!(raw instanceof Map<?, ?> map) || !Set.of("executionId", "datasetVersionSetId", "reference", "additionalReferences").containsAll(map.keySet())
        || !map.keySet().containsAll(Set.of("executionId", "datasetVersionSetId", "reference"))) throw invalid();
    List<ObjectQueryPort.Reference> additional = List.of();
    if (map.containsKey("additionalReferences")) {
      if (!(map.get("additionalReferences") instanceof List<?> list) || list.isEmpty() || list.size() > 2) throw invalid();
      additional = list.stream().map(ObjectSelection::readReference).toList();
    }
    return new ObjectSelection(text(map.get("executionId")), text(map.get("datasetVersionSetId")), readReference(map.get("reference")), additional);
  }

  private static ObjectQueryPort.Reference readReference(Object raw) {
    if (!(raw instanceof Map<?, ?> ref) || !ref.keySet().equals(Set.of("objectKey", "objectId", "productVersionId"))) throw invalid();
    return new ObjectQueryPort.Reference(text(ref.get("objectKey")), text(ref.get("objectId")), text(ref.get("productVersionId")));
  }
  private static Map<String, String> referenceMap(ObjectQueryPort.Reference ref) {
    return Map.of("objectKey", ref.objectKey(), "objectId", ref.objectId(), "productVersionId", ref.productVersionId());
  }

  private static String text(Object value) {
    if (!(value instanceof String text) || text.isBlank() || text.length() > 500) throw invalid();
    return text;
  }
  private static BackendException invalid() {
    return new BackendException("OBJECT_SELECTION_INVALID", "对象选择必须包含来源执行、冻结集合与完整对象引用，不能指定属性或权限。");
  }
}
