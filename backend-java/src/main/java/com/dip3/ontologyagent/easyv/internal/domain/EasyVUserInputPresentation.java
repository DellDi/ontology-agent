package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

/** 操作原话中的 $_(JSON) 选中对象标记；只使用源记录名称，不推断用户意图。 */
public final class EasyVUserInputPresentation {
  private static final ObjectMapper JSON = new ObjectMapper()
      .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
  private EasyVUserInputPresentation() {}

  public record Presentation(String text, boolean unresolvedReference) {}

  public static Presentation present(String original) {
    StringBuilder display = new StringBuilder();
    int position = 0;
    while (position < original.length()) {
      int start = original.indexOf("$_(", position);
      if (start < 0) {
        display.append(original.substring(position));
        break;
      }
      display.append(original, position, start);
      int end = referenceEnd(original, start + 3);
      if (end < 0) return new Presentation(original, true);
      Object value;
      try { value = JSON.readValue(original.substring(start + 3, end), Object.class); }
      catch (JsonProcessingException error) { return new Presentation(original, true); }
      if (!(value instanceof Map<?, ?> reference)) return new Presentation(original, true);
      String block = name(reference.get("label"));
      String component = name(reference.get("componentLabel"));
      // 缺少组件名称时不能只展示区域名称，造成选中对象范围被扩大。
      if (block == null || (name(reference.get("componentId")) != null && component == null)) {
        return new Presentation(original, true);
      }
      display.append('【').append(block);
      if (component != null) display.append(" / ").append(component);
      display.append('】');
      position = end + 1;
    }
    return new Presentation(display.toString(), false);
  }

  private static String name(Object value) {
    return value instanceof String text && !text.isBlank() ? text : null;
  }

  private static int referenceEnd(String text, int start) {
    int depth = 0;
    boolean quoted = false;
    boolean escaped = false;
    for (int i = start; i < text.length(); i++) {
      char character = text.charAt(i);
      if (quoted) {
        if (escaped) escaped = false;
        else if (character == '\\') escaped = true;
        else if (character == '"') quoted = false;
      } else if (character == '"') quoted = true;
      else if (character == '{' || character == '[') depth++;
      else if (character == '}' || character == ']') depth--;
      else if (character == ')' && depth == 0) return i;
    }
    return -1;
  }
}
