package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.support.BackendException;
import java.util.regex.Pattern;

final class SemanticNames {
  private static final Pattern MEMBER = Pattern.compile("[a-z][A-Za-z0-9]*");
  private static final Pattern CUBE = Pattern.compile("[A-Z][A-Za-z0-9]*");

  static void requireMember(String value, String what) {
    if (value == null || !MEMBER.matcher(value).matches()) {
      throw invalid(what + " 名称必须是小驼峰标识符：" + value);
    }
  }

  static void requireCubeName(String value) {
    if (value == null || !CUBE.matcher(value).matches()) {
      throw invalid("Cube 名称必须是大驼峰标识符：" + value);
    }
  }

  static void requireText(String value, String what) {
    if (value == null || value.isBlank()) throw invalid(what + " 不能为空");
  }

  static BackendException invalid(String message) {
    return new BackendException("SEMANTIC_MODEL_INVALID", "语义模型无效：" + message + "。");
  }

  private SemanticNames() {}
}
