package com.dip3.ontologyagent.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AuthSessionRepository {
    public static final Duration SESSION_TTL = Duration.ofHours(8);

    private final AuthSessionMapper mapper;

    public AuthSessionRepository(AuthSessionMapper mapper) {
        this.mapper = mapper;
    }

    public AuthSession create(AuthIdentity identity) {
        String sessionId = UUID.randomUUID().toString();
        Instant expiresAt = Instant.now().plus(SESSION_TTL);

        AuthSessionEntity entity = new AuthSessionEntity();
        entity.sessionId = sessionId;
        entity.userId = identity.userId();
        entity.displayName = identity.displayName();
        entity.organizationId = identity.scope().organizationId();
        entity.projectIds = distinct(identity.scope().projectIds());
        entity.areaIds = distinct(identity.scope().areaIds());
        entity.roleCodes = distinct(identity.scope().roleCodes());
        entity.expiresAt = expiresAt;
        mapper.insert(entity);

        return new AuthSession(sessionId, identity.userId(), identity.displayName(),
                identity.scope(), expiresAt);
    }

    public Optional<AuthSession> findValid(String sessionId) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<AuthSessionEntity>()
                        .eq(AuthSessionEntity::getSessionId, sessionId)
                        .gt(AuthSessionEntity::getExpiresAt, Instant.now())))
                .map(row -> new AuthSession(row.sessionId, row.userId, row.displayName,
                        new AccessScope(row.organizationId, Arrays.asList(row.projectIds), Arrays.asList(row.areaIds),
                                Arrays.asList(row.roleCodes)), row.expiresAt));
    }

    public void delete(String sessionId) {
        mapper.deleteById(sessionId);
    }

    private static String[] distinct(List<String> values) {
        return values.stream().distinct().toArray(String[]::new);
    }
}
