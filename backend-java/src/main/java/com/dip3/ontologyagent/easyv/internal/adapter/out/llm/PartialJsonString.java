package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

/**
 * 流式 JSON 的容错字段提取：响应按 chunk 到达时字段串可能尚未闭合，
 * 提取指定字符串字段"已完成的前缀"并做 JSON 反转义。找不到字段或未开始时返回 null。
 * 仅用于实时展示增量，最终解析仍走完整 JSON 校验。
 * 注：unicode 转义写作 uXXXX（四位十六进制）。
 */
final class PartialJsonString {

    private PartialJsonString() {}

    /**
     * 提取 buffer 中 "key" 字段的字符串值前缀：
     * 定位 "key" 后的冒号与开引号，扫描到未转义的闭引号（含）或 buffer 末尾；
     * 对截断的尾部转义（如半个 unicode 码点）保守丢弃，其余按 JSON 规则反转义。
     */
    static String valueAt(CharSequence buffer, String key) {
        int length = buffer.length();
        int i = 0;
        while (i < length) {
            int idx = indexOf(buffer, '"' + key + '"', i);
            if (idx < 0) return null;
            int p = idx + key.length() + 2;
            while (p < length && Character.isWhitespace(buffer.charAt(p))) p += 1;
            if (p < length && buffer.charAt(p) == ':') {
                p += 1;
                while (p < length && Character.isWhitespace(buffer.charAt(p))) p += 1;
                if (p < length && buffer.charAt(p) == '"') {
                    return unescapePrefix(buffer, p + 1);
                }
                return null; // 字段存在但值不是字符串开头——按无法提取处理
            }
            i = idx + 1;
        }
        return null;
    }

    private static int indexOf(CharSequence buffer, String needle, int from) {
        outer: for (int i = from; i + needle.length() <= buffer.length(); i += 1) {
            for (int j = 0; j < needle.length(); j += 1) {
                if (buffer.charAt(i + j) != needle.charAt(j)) continue outer;
            }
            return i;
        }
        return -1;
    }

    private static String unescapePrefix(CharSequence buffer, int start) {
        StringBuilder out = new StringBuilder(buffer.length() - start);
        for (int i = start; i < buffer.length(); i += 1) {
            char c = buffer.charAt(i);
            if (c == '"') break; // 字符串闭合，前缀到此为止
            if (c != '\\') {
                out.append(c);
                continue;
            }
            if (i + 1 >= buffer.length()) break; // 尾部半个反斜杠，丢弃
            char esc = buffer.charAt(i + 1);
            switch (esc) {
                case '"' -> { out.append('"'); i += 1; }
                case '\\' -> { out.append('\\'); i += 1; }
                case '/' -> { out.append('/'); i += 1; }
                case 'b' -> { out.append('\b'); i += 1; }
                case 'f' -> { out.append('\f'); i += 1; }
                case 'n' -> { out.append('\n'); i += 1; }
                case 'r' -> { out.append('\r'); i += 1; }
                case 't' -> { out.append('\t'); i += 1; }
                case 'u' -> {
                    if (i + 5 >= buffer.length()) return out.toString(); // 截断的 unicode 转义
                    int code = hex(buffer, i + 2);
                    if (code < 0) { out.append('\\').append('u'); i += 1; break; }
                    out.append((char) code);
                    i += 5;
                }
                default -> { out.append(esc); i += 1; }
            }
        }
        return out.toString();
    }

    private static int hex(CharSequence buffer, int start) {
        int value = 0;
        for (int j = 0; j < 4; j += 1) {
            char c = buffer.charAt(start + j);
            int digit = Character.digit(c, 16);
            if (digit < 0) return -1;
            value = (value << 4) | digit;
        }
        return value;
    }
}
