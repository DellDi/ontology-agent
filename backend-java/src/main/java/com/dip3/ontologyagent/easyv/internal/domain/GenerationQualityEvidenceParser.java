package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 只投影有当前业务调用者的路径；生成理解是系统自述，不认证为用户需求或最终质量。 */
public final class GenerationQualityEvidenceParser {
  public static final int TEXT_LIMIT = 4000;
  private static final ObjectMapper JSON = new ObjectMapper();
  private GenerationQualityEvidenceParser() {}

  public record Parsed(String status, String errorCode, String targetBlockId,
      String industryCategory, String audienceType, Map<String, Object> evidence) {}

  public static Parsed parse(String branch, String step, Object output) {
    if (!("MAIN".equals(branch) && "Step1".equals(step))
        && !("CHAT".equals(branch) && "ChatExecution".equals(step))) {
      return new Parsed("not_applicable", null, null, null, null, null);
    }
    if (output == null) return new Parsed("missing", "QUALITY_OUTPUT_MISSING", null, null, null, null);
    try {
      Map<?, ?> root = object(output instanceof String text ? JSON.readValue(text, Object.class) : output);
      if ("ChatExecution".equals(step)) {
        return new Parsed("available", null, text(root.get("blockId")), null, null, null);
      }
      Map<?, ?> wrapper = optionalObject(root.get("output"));
      Map<?, ?> raw = wrapper == null ? null : optionalObject(wrapper.get("raw"));
      if (raw == null) return new Parsed("missing", "STEP1_RAW_MISSING", null, null, null, null);
      Map<?, ?> context = optionalObject(raw.get("businessContext"));
      String industry = context == null ? null : text(context.get("industryCategory"));
      String audience = context == null ? null : text(context.get("audienceType"));
      Map<String, Object> result = new LinkedHashMap<>();
      List<String> truncated = new ArrayList<>();
      project(raw, result, "", truncated, "coreIntent", "pageTitle");
      Map<?, ?> objective = optionalObject(raw.get("screenObjective"));
      if (objective != null) {
        Map<String, Object> selected = new LinkedHashMap<>();
        project(objective, selected, "screenObjective.", truncated,
            "primaryGoal", "displayMode");
        result.put("screenObjective", selected);
      }
      if (raw.get("themes") != null) {
        List<Map<String, Object>> themes = new ArrayList<>();
        for (Object value : array(raw.get("themes"))) {
          Map<?, ?> theme = object(value);
          Map<String, Object> selected = new LinkedHashMap<>();
          String path = "themes[" + themes.size() + "].";
          project(theme, selected, path, truncated, "themeId", "businessModule", "intent", "moduleDescription");
          if (theme.get("constraints") != null) {
            List<Map<String, Object>> constraints = new ArrayList<>();
            for (Object item : array(theme.get("constraints"))) {
              Map<String, Object> constraint = new LinkedHashMap<>();
              project(object(item), constraint, path + "constraints[" + constraints.size() + "].", truncated,
                  "text", "origin", "evidence");
              constraints.add(constraint);
            }
            selected.put("constraints", constraints);
          }
          themes.add(selected);
        }
        result.put("themes", themes);
      }
      if (raw.get("interactionRequests") != null) {
        List<Map<String, Object>> requests = new ArrayList<>();
        for (Object value : array(raw.get("interactionRequests"))) {
          Map<String, Object> selected = new LinkedHashMap<>();
          project(object(value), selected, "interactionRequests[" + requests.size() + "].", truncated,
              "rawInstruction", "supported", "unsupportedReason");
          requests.add(selected);
        }
        result.put("interactionRequests", requests);
      }
      result.put("truncatedFields", truncated);
      return new Parsed("available", null, null, industry, audience, result);
    } catch (JsonProcessingException | IllegalArgumentException error) {
      return new Parsed("invalid", "QUALITY_OUTPUT_INVALID", null, null, null, null);
    }
  }

  private static void project(Map<?, ?> source, Map<String, Object> target, String prefix,
      List<String> truncated, String... keys) {
    for (String key : keys) {
      Object value = source.get(key);
      if (value == null) continue;
      if (value instanceof String text) {
        if (text.codePointCount(0, text.length()) > TEXT_LIMIT) {
          value = text.substring(0, text.offsetByCodePoints(0, TEXT_LIMIT));
          truncated.add(prefix + key);
        }
      } else if (!(value instanceof Boolean || value instanceof Number)) {
        throw new IllegalArgumentException("quality projection expects a scalar");
      }
      target.put(key, value);
    }
  }
  private static Map<?, ?> object(Object value) {
    if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException("quality object required");
    return map;
  }
  private static Map<?, ?> optionalObject(Object value) { return value == null ? null : object(value); }
  private static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw new IllegalArgumentException("quality array required");
    return list;
  }
  private static String text(Object value) {
    if (value == null) return null;
    if (!(value instanceof String text)) throw new IllegalArgumentException("quality text required");
    return text;
  }
}
