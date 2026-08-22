package com.dip3.ontologyagent.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.sql.Array;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;

@Component
public final class JsonCodec {
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private static final TypeReference<List<Map<String, Object>>> LIST = new TypeReference<>() {};
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    public String write(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new BackendException("JSON_SERIALIZATION_FAILED", "JSON 序列化失败。", error);
        }
    }

    public Map<String, Object> map(Object value) {
        if (value == null) return Map.of();
        try {
            return mapper.readValue(value.toString(), MAP);
        } catch (JsonProcessingException error) {
            throw new BackendException("DATABASE_JSON_INVALID", "数据库 JSON 对象无效。", error);
        }
    }

    public List<Map<String, Object>> list(Object value) {
        if (value == null) return List.of();
        try {
            return mapper.readValue(value.toString(), LIST);
        } catch (JsonProcessingException error) {
            throw new BackendException("DATABASE_JSON_INVALID", "数据库 JSON 数组无效。", error);
        }
    }

    public static List<String> strings(Array value) throws SQLException {
        return value == null ? List.of() : List.of((String[]) value.getArray());
    }
}
