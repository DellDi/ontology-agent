package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AnalysisSessionRepository {
    private final AnalysisSessionMapper mapper;

    public AnalysisSessionRepository(AnalysisSessionMapper mapper) {
        this.mapper = mapper;
    }

    public AnalysisSession create(AuthSession owner, String questionText, Map<String, Object> savedContext) {
        String id = UUID.randomUUID().toString();
        Instant now = Instant.now();
        AnalysisSessionEntity row = new AnalysisSessionEntity();
        row.id = id;
        row.ownerUserId = owner.userId();
        row.organizationId = owner.scope().organizationId();
        row.projectIds = owner.scope().projectIds().toArray(String[]::new);
        row.areaIds = owner.scope().areaIds().toArray(String[]::new);
        row.questionText = questionText;
        row.savedContext = savedContext;
        row.status = "pending";
        row.createdAt = now;
        row.updatedAt = now;
        mapper.insert(row);
        return new AnalysisSession(id, owner.userId(), owner.scope(), questionText, savedContext, "pending", now, now);
    }

    public Optional<AnalysisSession> findOwned(String sessionId, AuthSession viewer) {
        return Optional.ofNullable(mapper.selectById(sessionId)).map(row -> new AnalysisSession(row.id,
                        row.ownerUserId, new AccessScope(row.organizationId, Arrays.asList(row.projectIds),
                        Arrays.asList(row.areaIds), java.util.List.of()), row.questionText, row.savedContext,
                        row.status, row.createdAt, row.updatedAt))
                .filter(session -> session.accessibleBy(viewer));
    }
}
