package com.dip3.ontologyagent.property.internal.domain;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;

/** The explicitly supported project collection-rate capability boundary. */
public final class AnalysisCapabilityPolicy {
    private static final List<String> OTHER_METRICS = List.of(
            "工单", "投诉", "满意度", "关闭时长", "响应时长");
    private static final List<String> UNSUPPORTED_QUALIFIERS = List.of(
            "尾欠", "历史欠费", "往年欠费", "陈欠", "缴款日期", "付款日期", "支付日期", "实收日期",
            "缴费日期", "收款日期", "到账日期", "缴款时间", "付款时间", "支付时间", "收款时间",
            "到账时间", "实收账期", "会计账期", "账单截止", "结算日期");

    private AnalysisCapabilityPolicy() {}

    public static boolean unsupportedBusinessScope(String question) {
        String normalized = normalize(question);
        return List.of("客服", "crm", "营销", "转化", "呼叫中心", "热线", "坐席", "通话")
                .stream().anyMatch(normalized::contains);
    }

    public static boolean supportsInitialCollectionRate(String question) {
        String normalized = normalize(question);
        return List.of("收缴率", "收费率", "回款率").stream().anyMatch(normalized::contains)
                && OTHER_METRICS.stream().noneMatch(normalized::contains)
                && UNSUPPORTED_QUALIFIERS.stream().noneMatch(normalized::contains);
    }

    public static boolean supportsFollowUp(String question) {
        String normalized = normalize(question);
        return !unsupportedBusinessScope(normalized)
                && OTHER_METRICS.stream().noneMatch(normalized::contains)
                && UNSUPPORTED_QUALIFIERS.stream().noneMatch(normalized::contains);
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
                .replaceAll("[\\s\\u3000]+", "").toLowerCase(Locale.ROOT);
    }
}
