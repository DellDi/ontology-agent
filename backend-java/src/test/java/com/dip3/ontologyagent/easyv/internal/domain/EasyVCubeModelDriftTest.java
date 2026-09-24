package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.dip3.ontologyagent.semantic.api.CubeModelGenerator;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * 入库的 Cube 模型必须等于本体声明的生成结果。修改 {@link EasyVOntologyModel} 后执行
 * {@code mvn test -Dtest=EasyVCubeModelDriftTest -Dsemantic.regenerate=true} 重新生成。
 */
class EasyVCubeModelDriftTest {
  private static final Path CUBE_CONF = Path.of("..", "cube", "conf");
  private static final Path MODEL_DIR = CUBE_CONF.resolve("model").resolve("easyv");

  @Test
  void committedCubeModelMatchesOntologyDeclaration() throws IOException {
    Map<String, String> generated = CubeModelGenerator.generate(EasyVOntologyModel.OBJECTS);
    if (Boolean.getBoolean("semantic.regenerate")) {
      write(generated);
    }
    assertEquals(generated, committed());
  }

  private static void write(Map<String, String> generated) throws IOException {
    Files.createDirectories(MODEL_DIR);
    try (Stream<Path> stale = Files.list(MODEL_DIR)) {
      for (Path file : stale.filter(path -> path.toString().endsWith(".yml")).toList()) Files.delete(file);
    }
    for (Map.Entry<String, String> entry : generated.entrySet()) {
      Files.writeString(target(entry.getKey()), entry.getValue(), StandardCharsets.UTF_8);
    }
  }

  private static Map<String, String> committed() throws IOException {
    Map<String, String> files = new TreeMap<>();
    if (Files.isDirectory(MODEL_DIR)) {
      try (Stream<Path> models = Files.list(MODEL_DIR)) {
        for (Path file : models.filter(path -> path.toString().endsWith(".yml")).toList()) {
          files.put(file.getFileName().toString(), Files.readString(file, StandardCharsets.UTF_8));
        }
      }
    }
    Path index = target(CubeModelGenerator.VERSIONED_INDEX_FILE);
    if (Files.exists(index)) {
      files.put(CubeModelGenerator.VERSIONED_INDEX_FILE, Files.readString(index, StandardCharsets.UTF_8));
    }
    return files;
  }

  private static Path target(String name) {
    return CubeModelGenerator.VERSIONED_INDEX_FILE.equals(name) ? CUBE_CONF.resolve(name) : MODEL_DIR.resolve(name);
  }
}
