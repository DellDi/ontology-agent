package com.dip3.ontologyagent.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Arrays;
import java.util.Optional;

@Repository
public class AuthSessionRepository {
    private final AuthSessionMapper mapper;

    public AuthSessionRepository(AuthSessionMapper mapper) {
        this.mapper = mapper;
    }

    public Optional<AuthSession> findValid(String sessionId) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<AuthSessionEntity>()
                        .eq(AuthSessionEntity::getSessionId, sessionId)
                        .gt(AuthSessionEntity::getExpiresAt, Instant.now())))
                .map(row -> new AuthSession(row.sessionId, row.userId, row.displayName,
                        new AccessScope(row.organizationId, Arrays.asList(row.projectIds), Arrays.asList(row.areaIds),
                                Arrays.asList(row.roleCodes)), row.expiresAt));
    }
}
