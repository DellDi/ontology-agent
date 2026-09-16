package com.dip3.ontologyagent.capability.api;

import java.util.Map;

/**
 * 能力执行过程上报通道：由 Worker 注入，能力实现按阶段/工具粒度上报进度事件。
 * step/tool 载荷形状与前端 stream-models 的事件契约一致（id/order/title/status、name/label/durationMs）。
 */
@FunctionalInterface
public interface ExecutionProgress {
    ExecutionProgress NOOP = (kind, step, tool) -> {};

    void emit(String kind, Map<String, Object> step, Map<String, Object> tool);

    /** 回答生成过程的增量文本（累计值）：实现方转成 answer-delta 事件供前端流式渲染。 */
    default void emitAnswerDelta(String answerText) {}
}
