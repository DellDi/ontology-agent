package com.dip3.ontologyagent.easyv.internal.domain;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EasyVFailureReasonTest {

    @Test
    void blankAndNullReasonsBecomeUnrecorded() {
        assertEquals("未记录失败原因", EasyVFailureReason.label(null));
        assertEquals("未记录失败原因", EasyVFailureReason.label(""));
        assertEquals("未记录失败原因", EasyVFailureReason.label("   "));
    }

    @Test
    void knownSignaturesBecomeBusinessReadableLabels() {
        assertEquals("Agent 递归深度超限（未收敛）", EasyVFailureReason.label(
                "page-1__chart_1: config agent invoke threw: Recursion limit of 25 reached"));
        assertEquals("模型调用限流（429）", EasyVFailureReason.label(
                "dataSource agent invoke threw: 429 You have exceeded your current request limit"));
        assertEquals("模型请求超时", EasyVFailureReason.label(
                "dataSource agent invoke threw: Request timed out."));
    }

    @Test
    void unknownReasonsSurfaceTheMessageSignature() {
        assertEquals("NullPointerException at step x",
                EasyVFailureReason.label("page-2: agent invoke threw: NullPointerException at step x"));
        assertEquals("plain failure text",
                EasyVFailureReason.label("plain failure text"));
    }

    @Test
    void longReasonsAreTruncated() {
        String longReason = "x".repeat(200);
        String label = EasyVFailureReason.label(longReason);
        assertTrue(label.length() <= 81);
        assertTrue(label.endsWith("…"));
    }
}
