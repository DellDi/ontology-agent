package com.dip3.ontologyagent.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;

public final class JsonbTypeHandler extends BaseTypeHandler<Object> {
    private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();

    @Override
    public void setNonNullParameter(PreparedStatement statement, int index, Object parameter, JdbcType jdbcType)
            throws SQLException {
        try {
            statement.setObject(index, MAPPER.writeValueAsString(parameter), Types.OTHER);
        } catch (JsonProcessingException error) {
            throw new SQLException("JSONB 序列化失败。", error);
        }
    }

    @Override
    public Object getNullableResult(ResultSet resultSet, String columnName) throws SQLException {
        return read(resultSet.getString(columnName));
    }

    @Override
    public Object getNullableResult(ResultSet resultSet, int columnIndex) throws SQLException {
        return read(resultSet.getString(columnIndex));
    }

    @Override
    public Object getNullableResult(CallableStatement statement, int columnIndex) throws SQLException {
        return read(statement.getString(columnIndex));
    }

    private static Object read(String value) throws SQLException {
        if (value == null) return null;
        try {
            return MAPPER.readValue(value, Object.class);
        } catch (JsonProcessingException error) {
            throw new SQLException("数据库 JSONB 无效。", error);
        }
    }
}
