package com.dip3.ontologyagent.easyv.internal.domain;

import java.util.Map;
import java.util.regex.Pattern;

/** 只投影源端百分比组件框；缺失与不支持的单位不套用编辑器展示兜底。 */
public final class PrototypeComponentGeometry {
  private static final Pattern PERCENT = Pattern.compile("\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)\\s*%\\s*");
  private PrototypeComponentGeometry() {}
  public record Box(double x, double y, double width, double height) {}
  public record Parsed(String status, String errorCode, Box box) {}

  public static Parsed parse(Object rawConfig) {
    if (rawConfig == null) return new Parsed("missing", "COMPONENT_BOX_MISSING", null);
    if (!(rawConfig instanceof Map<?, ?> config)) return new Parsed("invalid", "COMPONENT_CONFIG_INVALID", null);
    for (String key : new String[]{"relativeX", "relativeY", "width", "height"}) {
      if (config.get(key) == null) return new Parsed("missing", "COMPONENT_BOX_MISSING", null);
    }
    try {
      var box = new Box(percent(config.get("relativeX")), percent(config.get("relativeY")),
          percent(config.get("width")), percent(config.get("height")));
      if (box.x() < 0 || box.y() < 0 || box.width() <= 0 || box.height() <= 0
          || box.x() + box.width() > 100 || box.y() + box.height() > 100) {
        return new Parsed("invalid", "COMPONENT_BOX_BOUNDS_INVALID", null);
      }
      return new Parsed("available", null, box);
    } catch (IllegalArgumentException failure) {
      return new Parsed("invalid", "COMPONENT_BOX_UNIT_INVALID", null);
    }
  }
  private static double percent(Object value) {
    if (!(value instanceof String text) || !PERCENT.matcher(text).matches()) throw new IllegalArgumentException();
    double result = Double.parseDouble(text.replace("%", "").trim());
    if (!Double.isFinite(result)) throw new IllegalArgumentException();
    return result;
  }
}
