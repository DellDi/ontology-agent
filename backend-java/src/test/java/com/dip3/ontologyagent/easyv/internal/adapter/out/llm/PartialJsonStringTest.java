package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class PartialJsonStringTest {

    @Test
    void 字段未出现时返回空() {
        assertNull(PartialJsonString.valueAt("{\"highlights\":[]}", "answer"));
        assertNull(PartialJsonString.valueAt("", "answer"));
    }

    @Test
    void 提取未闭合的字符串前缀() {
        assertEquals("截至目前的累计回答",
            PartialJsonString.valueAt("{\"answer\": \"截至目前的累计回答", "answer"));
    }

    @Test
    void 提取完整字符串并在闭引号处截断() {
        assertEquals("完整答案",
            PartialJsonString.valueAt("{\"answer\": \"完整答案\", \"highlights\": []}", "answer"));
    }

    @Test
    void 处理转义字符() {
        assertEquals("第一行\n第二行 \"引用\" 100%",
            PartialJsonString.valueAt(
                "{\"answer\": \"第一行\\n第二行 \\\"引用\\\" 100%\"}", "answer"));
    }

    @Test
    void 截断的转义序列保守丢弃() {
        // 尾部半个反斜杠不输出
        assertEquals("abc", PartialJsonString.valueAt("{\"answer\": \"abc\\", "answer"));
        // 截断的 unicode 转义不完整时不输出
        assertEquals("中文字", PartialJsonString.valueAt(
            "{\"answer\": \"中文字\\u4e2", "answer"));
    }

    @Test
    void 完整unicode转义正常反转义() {
        assertEquals("中文", PartialJsonString.valueAt(
            "{\"answer\": \"\\u4e2d\\u6587\"}", "answer"));
    }

    @Test
    void answer前有其它字段也能定位() {
        assertEquals("答案",
            PartialJsonString.valueAt(
                "{\"meta\": {\"x\": 1}, \"answer\"  :  \"答案\", \"s\": []}", "answer"));
    }

    @Test
    void 字段值为非字符串时返回空() {
        assertNull(PartialJsonString.valueAt("{\"answer\": 123}", "answer"));
    }
}
