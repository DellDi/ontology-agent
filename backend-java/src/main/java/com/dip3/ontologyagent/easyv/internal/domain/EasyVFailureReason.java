package com.dip3.ontologyagent.easyv.internal.domain;

/** 把 Forge 失败原因原文归一化为业务可读标签；无匹配模式时如实截断首行。 */
public final class EasyVFailureReason {
    private static final int MAX_LABEL_LENGTH = 80;

    private EasyVFailureReason() {}

    public static String label(String raw) {
        if (raw == null || raw.isBlank()) return "未记录失败原因";
        String lower = raw.toLowerCase();
        if (lower.contains("recursion limit")) return "Agent 递归深度超限（未收敛）";
        if (lower.contains("429") || lower.contains("rate limit") || lower.contains("rate-limit")
                || lower.contains("request limit")) {
            return "模型调用限流（429）";
        }
        if (lower.contains("timed out") || lower.contains("timeout")) return "模型请求超时";
        String signature = raw;
        int threw = lower.indexOf("threw:");
        if (threw >= 0) signature = raw.substring(threw + "threw:".length()).trim();
        String firstLine = signature.split("\\R", 2)[0].trim();
        return firstLine.length() <= MAX_LABEL_LENGTH
                ? firstLine
                : firstLine.substring(0, MAX_LABEL_LENGTH) + "…";
    }
}
