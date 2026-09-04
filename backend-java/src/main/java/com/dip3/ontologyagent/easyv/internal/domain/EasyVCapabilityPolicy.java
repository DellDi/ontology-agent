package com.dip3.ontologyagent.easyv.internal.domain;

import java.text.Normalizer;
import java.util.List;

/** Deterministic initial-question matching for the EasyV capability. */
public final class EasyVCapabilityPolicy {
  private static final List<String> DOMAIN_TERMS =
      List.of("easyv", "大屏", "forge", "原型生成", "组件生成", "流水线");
  private static final List<String> GENERATION_TERMS =
      List.of("生成", "质量", "失败", "耗时", "成功率", "阶段", "模板", "组件");
  private static final List<String> PROPERTY_TERMS =
      List.of("收缴率", "收费率", "回款率", "物业项目", "应收", "实收");

  private EasyVCapabilityPolicy() {}

  public static boolean supportsInitial(String rawQuestion) {
    String question =
        Normalizer.normalize(rawQuestion == null ? "" : rawQuestion, Normalizer.Form.NFKC)
            .toLowerCase();
    return PROPERTY_TERMS.stream().noneMatch(question::contains)
        && DOMAIN_TERMS.stream().anyMatch(question::contains)
        && GENERATION_TERMS.stream().anyMatch(question::contains);
  }
}
