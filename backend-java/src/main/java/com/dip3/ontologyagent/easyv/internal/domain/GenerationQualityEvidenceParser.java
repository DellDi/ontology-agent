package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 只投影有当前业务调用者的路径；生成理解是系统自述，不认证为用户需求或最终质量。 */
public final class GenerationQualityEvidenceParser {
  public static final int TEXT_LIMIT = 4000;
  public static final Set<String> STRUCTURED_FIELDS = Set.of("screenObjective", "themes", "interactionRequests");
  private static final ObjectMapper JSON = new ObjectMapper();
  private GenerationQualityEvidenceParser() {}

  public record Parsed(String status, String errorCode, String targetBlockId,
      String industryCategory, String audienceType, Map<String, Object> evidence) {}

  public record DisplayItem(String label, String value) {}

  /** 呈现既有采集投影，不重写源文，不把系统的出处/支持标记认证为事实。 */
  public static List<DisplayItem> present(String field, String original) {
    Object value = decode(original);
    List<DisplayItem> items = new ArrayList<>();
    switch (field) {
      case "screenObjective" -> {
        var objective = displayObject(value, Set.of("primaryGoal", "displayMode"));
        items.add(new DisplayItem("页面目标", recorded(objective, "primaryGoal", "本记录未提供页面目标")));
        if (text(objective.get("displayMode")) != null) {
          items.add(new DisplayItem("展示方式", "原值保留在源记录中，未自行解释"));
        }
      }
      case "themes" -> {
        var themes = array(value);
        boolean hasConstraints = themes.stream().map(GenerationQualityEvidenceParser::object)
            .anyMatch(theme -> theme.get("constraints") != null && !array(theme.get("constraints")).isEmpty());
        for (var entry : themes) {
          var theme = displayObject(entry, Set.of("themeId", "businessModule", "intent", "moduleDescription", "constraints"));
          items.add(new DisplayItem("模块", recorded(theme, "businessModule", "本记录未提供模块名称")));
          addText(items, theme, "intent", "模块用途");
          addText(items, theme, "moduleDescription", "模块说明");
          List<?> constraints = theme.get("constraints") == null ? List.of() : array(theme.get("constraints"));
          if (constraints.isEmpty() && hasConstraints) items.add(new DisplayItem("约束", "本模块未提供约束条目"));
          for (var constraint : constraints) {
            var detail = displayObject(constraint, Set.of("text", "origin", "evidence"));
            String origin = text(detail.get("origin"));
            String label = "USER".equals(origin) ? "用户要求（系统标记）"
                : "DERIVED".equals(origin) ? "系统补充建议" : "约束（来源未明确）";
            items.add(new DisplayItem(label, recorded(detail, "text", "本记录未提供约束内容")));
            addText(items, detail, "evidence", "要求依据（系统记录）");
          }
        }
        if (items.isEmpty()) items.add(new DisplayItem("模块", "本记录未提供模块条目"));
        else if (!hasConstraints) items.add(new DisplayItem("约束记录", "本记录未提供模块约束，不能据此判定用户没有提出要求"));
      }
      case "interactionRequests" -> {
        for (var entry : array(value)) {
          var request = displayObject(entry, Set.of("rawInstruction", "supported", "unsupportedReason"));
          items.add(new DisplayItem("交互诉求（系统记录）", recorded(request, "rawInstruction", "本记录未提供原指令")));
          Object supported = request.get("supported");
          if (supported != null && !(supported instanceof Boolean)) throw new IllegalArgumentException("support flag must be boolean");
          items.add(new DisplayItem("系统支持标记", Boolean.TRUE.equals(supported) ? "标记为支持，不能证明已实现"
              : Boolean.FALSE.equals(supported) ? "标记为不支持，不能认证实际能力" : "本记录未提供支持标记"));
          addText(items, request, "unsupportedReason", "记录中的原因");
        }
        if (items.isEmpty()) items.add(new DisplayItem("交互诉求", "本记录未提供交互条目"));
      }
      default -> throw new IllegalArgumentException("not a structured quality field");
    }
    return List.copyOf(items);
  }

  public static boolean isTruncated(String field, String original) {
    boolean truncated = false;
    for (var value : array(decode(original))) {
      String path = text(value);
      if (path == null) throw new IllegalArgumentException("truncation path required");
      if (path.equals(field) || path.startsWith(field + ".") || path.startsWith(field + "[")) truncated = true;
    }
    return truncated;
  }

  private static Object decode(String original) {
    try { return JSON.readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(original); }
    catch (JsonProcessingException error) { throw new IllegalArgumentException("quality presentation JSON invalid", error); }
  }

  private static Map<?, ?> displayObject(Object value, Set<String> allowed) {
    Map<?, ?> map = object(value);
    if (!allowed.containsAll(map.keySet())) throw new IllegalArgumentException("unknown quality presentation field");
    return map;
  }

  private static String recorded(Map<?, ?> source, String field, String missing) {
    String value = text(source.get(field));
    return value == null || value.isBlank() ? missing : value;
  }

  private static void addText(List<DisplayItem> items, Map<?, ?> source, String field, String label) {
    String value = text(source.get(field));
    if (value != null && !value.isBlank()) items.add(new DisplayItem(label, value));
  }

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
