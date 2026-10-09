package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/** 可读对象目录只在 EasyVOntologyModel 声明一次；共享契约中的对象枚举必须与某个明确目录一致。 */
class EasyVReadableObjectCatalogContractTest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Path SCHEMAS = Path.of("..", "contracts", "backend", "schemas");
  private static final Set<String> SUMMARY = Set.of("easyv-prototype-layout", "easyv-prototype-block");

  @Test
  void catalogOnlyContainsDeclaredObjectsWithFrozenProducts() {
    var model = SemanticModel.discover();
    for (String key : EasyVOntologyModel.READABLE_OBJECT_KEYS) {
      assertEquals(key, model.require(key).productKey(), "读取冻结版本按产品 key 解析：" + key);
    }
    assertEquals(Set.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component"),
        EasyVOntologyModel.READABLE_OBJECT_KEYS);
  }

  @Test
  void everyContractEnumListingEasyVObjectsMatchesAnExplicitCatalog() throws IOException {
    var catalogs = List.of(EasyVOntologyModel.READABLE_OBJECT_KEYS, EasyVAgentTools.OBJECTS, SUMMARY);
    Map<String, Integer> readable = new TreeMap<>();
    try (Stream<Path> files = Files.list(SCHEMAS)) {
      for (Path file : files.filter(path -> path.toString().endsWith(".schema.json")).toList()) {
        for (Set<String> values : enums(JSON.readTree(Files.readString(file)))) {
          assertTrue(catalogs.contains(values), file.getFileName() + " 的对象枚举与任何明确目录都不一致：" + values);
          if (values.equals(EasyVOntologyModel.READABLE_OBJECT_KEYS)) readable.merge(file.getFileName().toString(), 1, Integer::sum);
        }
      }
    }
    assertEquals(Set.of("object-read-request.schema.json", "object-read-result.schema.json",
        "conclusion-state.schema.json", "easyv-semantic-plan.schema.json"), readable.keySet());
  }

  private static List<Set<String>> enums(JsonNode node) {
    List<Set<String>> found = new ArrayList<>();
    if (node.isObject()) {
      var values = node.get("enum");
      if (values != null && values.isArray()) {
        Set<String> set = new HashSet<>();
        values.forEach(value -> set.add(value.asText()));
        if (set.contains("easyv-prototype-layout")) found.add(Set.copyOf(set));
      }
      node.forEach(child -> found.addAll(enums(child)));
    } else if (node.isArray()) node.forEach(child -> found.addAll(enums(child)));
    return found;
  }
}
