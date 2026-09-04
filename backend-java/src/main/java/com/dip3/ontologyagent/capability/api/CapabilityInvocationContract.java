package com.dip3.ontologyagent.capability.api;

/**
 * The auditable invocation contract owned by a capability.
 *
 * <p>The execution platform records invocations generically. A capability
 * declares which invocation kind and tool name belong to its main execution,
 * how many calls are required, and how that count is exposed in completion
 * metadata.</p>
 */
public record CapabilityInvocationContract(String invocationType, String toolName, int exactCount,
                                           String actorLabel, String invocationLabel,
                                           String completionMetricKey) {
    public CapabilityInvocationContract {
        if (invocationType == null || invocationType.isBlank()) {
            throw new IllegalArgumentException("invocationType must not be blank");
        }
        if (toolName == null || toolName.isBlank()) {
            throw new IllegalArgumentException("toolName must not be blank");
        }
        if (exactCount < 0) {
            throw new IllegalArgumentException("exactCount must not be negative");
        }
        if (actorLabel == null || actorLabel.isBlank()) {
            throw new IllegalArgumentException("actorLabel must not be blank");
        }
        if (invocationLabel == null || invocationLabel.isBlank()) {
            throw new IllegalArgumentException("invocationLabel must not be blank");
        }
        if (completionMetricKey == null || completionMetricKey.isBlank()) {
            throw new IllegalArgumentException("completionMetricKey must not be blank");
        }
    }

    public String retryFenceMessage() {
        return "上一次租约内已开始 " + invocationLabel + "，禁止再次调用 Agent；本次执行显式失败。";
    }

    public String contractViolationMessage(long actualCount) {
        String expected = exactCount == 1 ? "一次" : exactCount + " 次";
        return actorLabel + " 必须且只能调用" + expected + " " + toolName
                + "，实际调用 " + actualCount + " 次。";
    }
}
