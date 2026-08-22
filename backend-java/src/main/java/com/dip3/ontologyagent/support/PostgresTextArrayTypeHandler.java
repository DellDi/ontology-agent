package com.dip3.ontologyagent.support;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.Array;
import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class PostgresTextArrayTypeHandler extends BaseTypeHandler<String[]> {
    @Override
    public void setNonNullParameter(PreparedStatement statement, int index, String[] parameter, JdbcType jdbcType)
            throws SQLException {
        statement.setArray(index, statement.getConnection().createArrayOf("text", parameter));
    }

    @Override
    public String[] getNullableResult(ResultSet resultSet, String columnName) throws SQLException {
        return read(resultSet.getArray(columnName));
    }

    @Override
    public String[] getNullableResult(ResultSet resultSet, int columnIndex) throws SQLException {
        return read(resultSet.getArray(columnIndex));
    }

    @Override
    public String[] getNullableResult(CallableStatement statement, int columnIndex) throws SQLException {
        return read(statement.getArray(columnIndex));
    }

    private static String[] read(Array value) throws SQLException {
        return value == null ? new String[0] : (String[]) value.getArray();
    }
}
