package com.dip3.ontologyagent.auth;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler;

import java.time.Instant;

@TableName(value = "platform.auth_sessions", autoResultMap = true)
public class AuthSessionEntity {
    @TableId("session_id")
    public String sessionId;
    public String userId;
    public String displayName;
    public String organizationId;
    @TableField(typeHandler = PostgresTextArrayTypeHandler.class)
    public String[] projectIds;
    @TableField(typeHandler = PostgresTextArrayTypeHandler.class)
    public String[] areaIds;
    @TableField(typeHandler = PostgresTextArrayTypeHandler.class)
    public String[] roleCodes;
    public Instant expiresAt;
    public Instant createdAt;

    public String getSessionId() { return sessionId; }
    public Instant getExpiresAt() { return expiresAt; }
}
