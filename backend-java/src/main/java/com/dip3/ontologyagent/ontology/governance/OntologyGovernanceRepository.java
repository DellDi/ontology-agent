package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static com.dip3.ontologyagent.ontology.governance.GovernanceResponses.*;

@Repository
public class OntologyGovernanceRepository {
    private final OntologyGovernanceMapper mapper;

    public OntologyGovernanceRepository(OntologyGovernanceMapper mapper) {
        this.mapper = mapper;
    }

    Optional<OntologyVersionSummary> findVersion(String id) {
        return Optional.ofNullable(mapper.findVersion(id)).map(OntologyGovernanceRepository::version);
    }

    void lockPublishing() {
        if (!mapper.tryLockPublish()) {
            throw new BackendException("ONTOLOGY_PUBLISH_CONFLICT", "另一个本体版本正在发布，请刷新后重试。");
        }
    }

    Optional<OntologyVersionSummary> lockVersion(String id) {
        return Optional.ofNullable(mapper.lockVersion(id)).map(OntologyGovernanceRepository::version);
    }

    List<OntologyVersionSummary> listVersions(int limit) {
        return mapper.listVersions(limit).stream().map(OntologyGovernanceRepository::version).toList();
    }

    List<OntologyVersionSummary> lockAllVersions() {
        return mapper.lockAllVersions().stream().map(OntologyGovernanceRepository::version).toList();
    }

    List<GovernanceRows.DefinitionRow> listDefinitions(String versionId) {
        return mapper.listDefinitions(versionId);
    }

    List<String> publishIntegrityIssues(String versionId) {
        return mapper.publishIntegrityIssues(versionId);
    }

    OntologyChangeRequest create(CreateChangeRequest input, String actorId, Instant now) {
        GovernanceRows.ChangeRequestRow row = new GovernanceRows.ChangeRequestRow();
        row.id = java.util.UUID.randomUUID().toString();
        row.ontologyVersionId = input.ontologyVersionId();
        row.targetObjectType = input.targetObjectType();
        row.targetObjectKey = input.targetObjectKey();
        row.changeType = input.changeType();
        row.status = "draft";
        row.title = input.title();
        row.description = input.description();
        row.beforeSummary = input.beforeSummary();
        row.afterSummary = input.afterSummary();
        row.impactScope = input.impactScope().toArray(String[]::new);
        row.compatibilityType = input.compatibilityType();
        row.compatibilityNote = input.compatibilityNote();
        row.submittedBy = actorId;
        row.createdAt = now;
        row.updatedAt = now;
        if (mapper.insertChangeRequest(row) != 1) {
            throw new BackendException("ONTOLOGY_CHANGE_REQUEST_CREATE_FAILED", "本体变更申请写入失败。");
        }
        return changeRequest(row);
    }

    Optional<OntologyChangeRequest> findChangeRequest(String id) {
        return Optional.ofNullable(mapper.findChangeRequest(id)).map(OntologyGovernanceRepository::changeRequest);
    }

    Optional<OntologyChangeRequest> lockChangeRequest(String id) {
        return Optional.ofNullable(mapper.lockChangeRequest(id)).map(OntologyGovernanceRepository::changeRequest);
    }

    List<OntologyChangeRequest> listChangeRequests(String status, int limit) {
        var rows = status == null ? mapper.listChangeRequests(limit) : mapper.listChangeRequestsByStatus(status, limit);
        return rows.stream().map(OntologyGovernanceRepository::changeRequest).toList();
    }

    List<OntologyChangeRequest> lockChangeRequestsForVersion(String versionId) {
        return mapper.lockChangeRequestsForVersion(versionId).stream()
                .map(OntologyGovernanceRepository::changeRequest).toList();
    }

    OntologyChangeRequest transition(OntologyChangeRequest current, String next, Instant submittedAt, Instant now) {
        if (mapper.transitionChangeRequest(current.id(), current.status(), next, submittedAt, now) != 1) {
            throw new BackendException("ONTOLOGY_CHANGE_REQUEST_STATE_CONFLICT",
                    "本体变更申请已被其他请求更新，请刷新后重试。");
        }
        return findChangeRequest(current.id()).orElseThrow();
    }

    OntologyApprovalRecord insertApproval(String changeRequestId, String decision, String actorId,
                                           String comment, Instant now) {
        GovernanceRows.ApprovalRow row = new GovernanceRows.ApprovalRow();
        row.id = java.util.UUID.randomUUID().toString();
        row.changeRequestId = changeRequestId;
        row.decision = decision;
        row.reviewedBy = actorId;
        row.comment = comment;
        row.createdAt = now;
        if (mapper.insertApproval(row) != 1) {
            throw new BackendException("ONTOLOGY_APPROVAL_WRITE_FAILED", "本体审批记录写入失败。");
        }
        return approval(row);
    }

    List<OntologyApprovalRecord> listApprovals(String id) {
        return mapper.listApprovals(id).stream().map(OntologyGovernanceRepository::approval).toList();
    }

    void publishVersion(String id, Instant now) {
        if (mapper.publishVersion(id, now) != 1) {
            throw new BackendException("ONTOLOGY_PUBLISH_CONFLICT", "本体版本发布状态已变化，请刷新后重试。");
        }
    }

    void deprecateVersion(String id, Instant now) {
        if (mapper.deprecateVersion(id, now) != 1) {
            throw new BackendException("ONTOLOGY_PUBLISH_CONFLICT", "前版本状态已变化，发布事务已回滚。");
        }
    }

    OntologyPublishRecord insertPublish(String versionId, String actorId, String previousVersionId,
                                        List<String> changeRequestIds, String note, Instant now) {
        GovernanceRows.PublishRow row = new GovernanceRows.PublishRow();
        row.id = java.util.UUID.randomUUID().toString();
        row.ontologyVersionId = versionId;
        row.publishedBy = actorId;
        row.previousVersionId = previousVersionId;
        row.changeRequestIds = changeRequestIds.toArray(String[]::new);
        row.publishNote = note;
        row.createdAt = now;
        if (mapper.insertPublish(row) != 1) {
            throw new BackendException("ONTOLOGY_PUBLISH_RECORD_WRITE_FAILED", "本体发布记录写入失败。");
        }
        return publish(row);
    }

    List<OntologyPublishRecord> listPublishes(int limit) {
        return mapper.listPublishes(limit).stream().map(OntologyGovernanceRepository::publish).toList();
    }

    long countChangeRequests(String status) {
        return mapper.countChangeRequests(status);
    }

    void audit(AuthSession actor, String eventType, String correlationId, Map<String, Object> payload, Instant now) {
        var auditActor = new OntologyGovernanceMapper.GovernanceAuditActor(actor.userId(),
                actor.scope().organizationId(), actor.sessionId());
        if (mapper.insertAudit(java.util.UUID.randomUUID().toString(), auditActor, eventType, correlationId,
                payload, now, now.plus(180, ChronoUnit.DAYS)) != 1) {
            throw new BackendException("ONTOLOGY_AUDIT_WRITE_FAILED", "本体治理审计记录写入失败。");
        }
    }

    private static OntologyVersionSummary version(GovernanceRows.VersionRow row) {
        return new OntologyVersionSummary(row.id, row.semver, row.displayName, row.status, row.description,
                row.publishedAt, row.deprecatedAt, row.retiredAt, row.createdBy, row.createdAt, row.updatedAt);
    }

    private static OntologyChangeRequest changeRequest(GovernanceRows.ChangeRequestRow row) {
        return new OntologyChangeRequest(row.id, row.ontologyVersionId, row.targetObjectType, row.targetObjectKey,
                row.changeType, row.status, row.title, row.description, row.beforeSummary, row.afterSummary,
                row.impactScope == null ? List.of() : List.copyOf(Arrays.asList(row.impactScope)),
                row.compatibilityType, row.compatibilityNote, row.submittedBy, row.submittedAt,
                row.createdAt, row.updatedAt);
    }

    private static OntologyApprovalRecord approval(GovernanceRows.ApprovalRow row) {
        return new OntologyApprovalRecord(row.id, row.changeRequestId, row.decision, row.reviewedBy,
                row.comment, row.createdAt);
    }

    private static OntologyPublishRecord publish(GovernanceRows.PublishRow row) {
        return new OntologyPublishRecord(row.id, row.ontologyVersionId, row.publishedBy, row.previousVersionId,
                row.changeRequestIds == null ? List.of() : List.copyOf(Arrays.asList(row.changeRequestIds)),
                row.publishNote, row.createdAt);
    }

    static DatabaseDefinition definition(GovernanceRows.DefinitionRow row) {
        return new DatabaseDefinition(row.id, row.ontologyVersionId, row.businessKey, row.displayName,
                row.description, row.status, row.fields == null ? Map.of() : new LinkedHashMap<>(row.fields),
                row.createdAt, row.updatedAt);
    }
}
