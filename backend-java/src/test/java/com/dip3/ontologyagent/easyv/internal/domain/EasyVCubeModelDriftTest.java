package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.semantic.api.CubeModelGenerator;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * 入库的 Cube 模型与访问策略必须等于全部领域本体声明（ServiceLoader 汇总）的生成结果。修改本体声明后执行
 * {@code mvn test -Dtest=EasyVCubeModelDriftTest -Dsemantic.regenerate=true} 重新生成。
 */
class EasyVCubeModelDriftTest {
  private static final Path CUBE_CONF = Path.of("..", "cube", "conf");

  @Test
  void committedCubeArtifactsMatchOntologyDeclarations() throws IOException {
    SemanticModel model = SemanticModel.discover();
    Map<String, String> generated = CubeModelGenerator.generate(model);
    if (Boolean.getBoolean("semantic.regenerate")) {
      write(model, generated);
    }
    assertEquals(generated, committed(model));
  }

  @Test
  void easyvContributionIsDiscoveredWithAllObjects() {
    SemanticModel model = SemanticModel.discover();
    assertEquals(EasyVOntologyModel.OBJECTS, model.objects(EasyVGenerationOntology.DOMAIN_KEY));
    assertTrue(model.objects().containsAll(EasyVOntologyModel.OBJECTS));
  }

  private static void write(SemanticModel model, Map<String, String> generated) throws IOException {
    for (var contribution : model.contributions()) {
      Path dir = CUBE_CONF.resolve(CubeModelGenerator.MODEL_DIR).resolve(contribution.domainKey());
      Files.createDirectories(dir);
      try (Stream<Path> stale = Files.list(dir)) {
        for (Path file : stale.filter(path -> path.toString().endsWith(".yml")).toList()) Files.delete(file);
      }
    }
    for (Map.Entry<String, String> entry : generated.entrySet()) {
      Files.writeString(CUBE_CONF.resolve(entry.getKey()), entry.getValue(), StandardCharsets.UTF_8);
    }
  }

  private static Map<String, String> committed(SemanticModel model) throws IOException {
    Map<String, String> files = new TreeMap<>();
    for (var contribution : model.contributions()) {
      String relative = CubeModelGenerator.MODEL_DIR + "/" + contribution.domainKey();
      Path dir = CUBE_CONF.resolve(relative);
      if (!Files.isDirectory(dir)) continue;
      try (Stream<Path> models = Files.list(dir)) {
        for (Path file : models.filter(path -> path.toString().endsWith(".yml")).toList()) {
          files.put(relative + "/" + file.getFileName(), Files.readString(file, StandardCharsets.UTF_8));
        }
      }
    }
    Path policy = CUBE_CONF.resolve(CubeModelGenerator.ACCESS_POLICY_FILE);
    if (Files.exists(policy)) {
      files.put(CubeModelGenerator.ACCESS_POLICY_FILE, Files.readString(policy, StandardCharsets.UTF_8));
    }
    return files;
  }
}
