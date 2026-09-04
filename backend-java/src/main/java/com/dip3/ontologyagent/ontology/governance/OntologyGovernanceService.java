package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.dip3.ontologyagent.ontology.governance.GovernanceResponses.*;

@Service
public class OntologyGovernanceService {
    private static final Set<String> STATUSES = Set.of("draft", "submitted", "approved", "rejected",
            "published", "superseded");
    private static final Set<String> TARGET_TYPES = Set.of("entity_definition", "metric_definition",
            "metric_variant", "factor_definition", "causality_edge", "plan_step_template",
            "tool_capability_binding", "time_semantic", "evidence_type_definition");
    private static final Set<String> CHANGE_TYPES = Set.of("create", "update", "deprecate", "retire");
    private static final Set<String> COMPATIBILITY_TYPES = Set.of("backward_compatible", "breaking");
    private static final Set<String> DECISIONS = Set.of("approved", "rejected");

    private final OntologyGovernanceRepository repository;
    private final OntologyRepository ontologies;
    private final CapabilityRegistry capabilities;

    public OntologyGovernanceService(OntologyGovernanceRepository repository, OntologyRepository ontologies,
                                     CapabilityRegistry capabilities) {
        this.repository = repository;
        this.ontologies = ontologies;
        this.capabilities = capabilities;
    }

    public GovernanceOverview overview(AuthSession actor) {
        GovernanceCapabilities capabilities = capabilities(actor);
        List<OntologyVersionSummary> versions = repository.listVersions(200);
        OntologyVersionSummary current = versions.stream()
                .filter(version -> "approved".equals(version.status()) && version.publishedAt() != null)
                .findFirst().orElse(null);
        OntologyVersionSummary latestApproved = versions.stream()
                .filter(version -> "approved".equals(version.status())).findFirst().orElse(null);
        return new GovernanceOverview(current, latestApproved,
                repository.countChangeRequests("submitted"), repository.countChangeRequests("approved"),
                repository.listChangeRequests(null, 10), repository.listPublishes(5), capabilities);
    }

    public VersionList versions(int limit, AuthSession actor) {
        GovernanceCapabilities capabilities = capabilities(actor);
        return new VersionList(repository.listVersions(limit(limit)), capabilities);
    }

    public GovernanceDefinitions definitions(String versionId, AuthSession actor) {
        GovernanceCapabilities capabilities = capabilities(actor);
        String id = required(versionId, "本体版本 ID", 200);
        OntologyVersionSummary version = repository.findVersion(id)
                .orElseThrow(() -> new BackendException("ONTOLOGY_VERSION_NOT_FOUND", "目标本体版本不存在。"));
        List<GovernanceRows.DefinitionRow> rows = repository.listDefinitions(id);
        return new GovernanceDefinitions(version,
                definitions(rows, "entities"), definitions(rows, "metrics"),
                definitions(rows, "metricVariants"), definitions(rows, "factors"),
                definitions(rows, "causalityEdges"), definitions(rows, "planStepTemplates"),
                definitions(rows, "toolBindings"), definitions(rows, "timeSemantics"),
                definitions(rows, "evidenceTypes"), capabilities);
    }

    public ChangeRequestList changeRequests(String status, int limit, AuthSession actor) {
        GovernanceCapabilities capabilities = capabilities(actor);
        String normalized = blankToNull(status);
        if (normalized != null && !STATUSES.contains(normalized)) {
            throw new BackendException("ONTOLOGY_CHANGE_REQUEST_STATUS_INVALID", "变更申请状态无效。");
        }
        return new ChangeRequestList(repository.listChangeRequests(normalized, limit(limit)), capabilities);
    }

    public ChangeRequestDetail changeRequest(String id, AuthSession actor) {
        GovernanceCapabilities capabilities = capabilities(actor);
        OntologyChangeRequest request = repository.findChangeRequest(required(id, "变更申请 ID", 200))
                .orElseThrow(() -> new BackendException("ONTOLOGY_CHANGE_REQUEST_NOT_FOUND", "本体变更申请不存在。"));
        return new ChangeRequestDetail(request, repository.listApprovals(request.id()), capabilities);
    }

    public PublishHistory publishes(int limit, AuthSession actor) {
        GovernanceCapabilities capabilities = capabilities(actor);
        return new PublishHistory(repository.listPublishes(limit(limit)), capabilities);
    }

    @Transactional
    public OntologyChangeRequest create(CreateChangeRequest raw, AuthSession actor, String traceId) {
        GovernanceCapabilities capabilities = GovernanceCapabilities.from(actor);
        capabilities.requireAuthor();
        CreateChangeRequest input = validate(raw);
        OntologyVersionSummary version = repository.findVersion(input.ontologyVersionId())
                .orElseThrow(() -> new BackendException("ONTOLOGY_VERSION_NOT_FOUND", "目标本体版本不存在。"));
        if (version.publishedAt() != null || !Set.of("draft", "review", "approved").contains(version.status())) {
            throw new BackendException("ONTOLOGY_VERSION_NOT_EDITABLE", "只能对尚未发布的可编辑版本创建变更申请。");
        }
        Instant now = Instant.now();
        OntologyChangeRequest created = repository.create(input, actor.userId(), now);
        repository.audit(actor, "ontology.change_request.created", traceId,
                Map.of("changeRequestId", created.id(), "ontologyVersionId", created.ontologyVersionId()), now);
        return created;
    }

    @Transactional
    public OntologyChangeRequest submit(String id, AuthSession actor, String traceId) {
        GovernanceCapabilities.from(actor).requireAuthor();
        OntologyChangeRequest current = lockChangeRequest(id);
        requireState(current, "draft", "ONTOLOGY_CHANGE_REQUEST_SUBMIT_CONFLICT",
                "只有草稿变更申请可以提交审批。");
        Instant now = Instant.now();
        OntologyChangeRequest submitted = repository.transition(current, "submitted", now, now);
        repository.audit(actor, "ontology.change_request.submitted", traceId,
                Map.of("changeRequestId", submitted.id(), "ontologyVersionId", submitted.ontologyVersionId()), now);
        return submitted;
    }

    @Transactional
    public ReviewResult review(String id, ReviewChangeRequest raw, AuthSession actor, String traceId) {
        GovernanceCapabilities.from(actor).requireReview();
        String decision = required(raw == null ? null : raw.decision(), "审批决定", 20);
        if (!DECISIONS.contains(decision)) {
            throw new BackendException("ONTOLOGY_REVIEW_DECISION_INVALID", "审批决定只能是 approved 或 rejected。");
        }
        String comment = optional(raw == null ? null : raw.comment(), 1000, "审批意见");
        OntologyChangeRequest current = lockChangeRequest(id);
        requireState(current, "submitted", "ONTOLOGY_CHANGE_REQUEST_REVIEW_CONFLICT",
                "只有待审批变更申请可以审批。");
        Instant now = Instant.now();
        OntologyApprovalRecord approval = repository.insertApproval(current.id(), decision, actor.userId(), comment, now);
        OntologyChangeRequest reviewed = repository.transition(current, decision, null, now);
        repository.audit(actor, "ontology.change_request." + decision, traceId,
                Map.of("changeRequestId", reviewed.id(), "ontologyVersionId", reviewed.ontologyVersionId(),
                        "approvalRecordId", approval.id()), now);
        return new ReviewResult(reviewed, approval);
    }

    @Transactional
    public OntologyPublishRecord publish(String versionId, PublishVersion raw, AuthSession actor, String traceId) {
        GovernanceCapabilities.from(actor).requirePublish();
        String targetId = required(versionId, "本体版本 ID", 200);
        String note = optional(raw == null ? null : raw.publishNote(), 1000, "发布说明");
        repository.lockPublishing();
        List<OntologyVersionSummary> versions = repository.lockAllVersions();
        OntologyVersionSummary target = versions.stream().filter(version -> version.id().equals(targetId)).findFirst()
                .orElseThrow(() -> new BackendException("ONTOLOGY_VERSION_NOT_FOUND", "目标本体版本不存在。"));
        if (!"approved".equals(target.status()) || target.publishedAt() != null) {
            throw new BackendException("ONTOLOGY_PUBLISH_CONFLICT", "目标版本必须是尚未发布的 approved 版本。");
        }
        List<OntologyChangeRequest> requests = repository.lockChangeRequestsForVersion(targetId);
        if (requests.stream().anyMatch(request -> "submitted".equals(request.status()))) {
            throw new BackendException("ONTOLOGY_PUBLISH_PENDING_REVIEW", "目标版本仍有待审批变更申请。");
        }
        List<OntologyChangeRequest> approved = requests.stream()
                .filter(request -> "approved".equals(request.status())).toList();
        List<String> integrityIssues = repository.publishIntegrityIssues(targetId);
        if (!integrityIssues.isEmpty()) {
            throw new BackendException("ONTOLOGY_PUBLISH_INTEGRITY_INVALID",
                    "目标版本的本体定义不完整：" + String.join(", ", integrityIssues));
        }
        capabilities.validateCatalog(ontologies.approvedCandidate(targetId));
        List<OntologyVersionSummary> current = versions.stream()
                .filter(version -> !version.id().equals(targetId))
                .filter(version -> "approved".equals(version.status()) && version.publishedAt() != null).toList();
        if (current.size() > 1) {
            throw new BackendException("ONTOLOGY_PUBLISH_STATE_INVALID", "数据库存在多个当前发布版本，必须先修复事实源。");
        }
        Instant now = Instant.now();
        String previousId = current.isEmpty() ? null : current.getFirst().id();
        if (previousId != null) repository.deprecateVersion(previousId, now);
        repository.publishVersion(targetId, now);
        for (OntologyChangeRequest request : approved) repository.transition(request, "published", null, now);
        OntologyPublishRecord record = repository.insertPublish(targetId, actor.userId(), previousId,
                approved.stream().map(OntologyChangeRequest::id).toList(), note, now);
        Map<String, Object> audit = new LinkedHashMap<>();
        audit.put("ontologyVersionId", targetId);
        audit.put("publishRecordId", record.id());
        audit.put("changeRequestIds", record.changeRequestIds());
        if (previousId != null) audit.put("previousVersionId", previousId);
        repository.audit(actor, "ontology.version.published", traceId, audit, now);
        return record;
    }

    private GovernanceCapabilities capabilities(AuthSession actor) {
        GovernanceCapabilities capabilities = GovernanceCapabilities.from(actor);
        capabilities.requireView();
        return capabilities;
    }

    private OntologyChangeRequest lockChangeRequest(String id) {
        return repository.lockChangeRequest(required(id, "变更申请 ID", 200))
                .orElseThrow(() -> new BackendException("ONTOLOGY_CHANGE_REQUEST_NOT_FOUND", "本体变更申请不存在。"));
    }

    private static void requireState(OntologyChangeRequest request, String expected, String code, String message) {
        if (!expected.equals(request.status())) throw new BackendException(code, message);
    }

    private static CreateChangeRequest validate(CreateChangeRequest raw) {
        if (raw == null) throw new BackendException("ONTOLOGY_CHANGE_REQUEST_INVALID", "请求体不能为空。");
        String targetType = required(raw.targetObjectType(), "目标对象类型", 80);
        String changeType = required(raw.changeType(), "变更类型", 30);
        String compatibility = required(raw.compatibilityType(), "兼容性类型", 40);
        if (!TARGET_TYPES.contains(targetType) || !CHANGE_TYPES.contains(changeType)
                || !COMPATIBILITY_TYPES.contains(compatibility)) {
            throw new BackendException("ONTOLOGY_CHANGE_REQUEST_INVALID", "变更申请枚举字段无效。");
        }
        List<String> impact = raw.impactScope() == null ? List.of() : raw.impactScope().stream()
                .map(value -> required(value, "影响范围", 200)).distinct().toList();
        return new CreateChangeRequest(required(raw.ontologyVersionId(), "本体版本 ID", 200), targetType,
                required(raw.targetObjectKey(), "目标对象键", 200), changeType,
                required(raw.title(), "标题", 200), optional(raw.description(), 2000, "描述"),
                raw.beforeSummary(), raw.afterSummary(), impact, compatibility,
                optional(raw.compatibilityNote(), 1000, "兼容性说明"));
    }

    private static int limit(int limit) {
        if (limit < 1 || limit > 200) throw new BackendException("ONTOLOGY_QUERY_LIMIT_INVALID", "limit 必须在 1 到 200 之间。");
        return limit;
    }

    private static String required(String value, String label, int max) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty() || normalized.length() > max) {
            throw new BackendException("ONTOLOGY_INPUT_INVALID", label + "不能为空且长度不能超过 " + max + "。 ");
        }
        return normalized;
    }

    private static String optional(String value, int max, String label) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        if (normalized.length() > max) throw new BackendException("ONTOLOGY_INPUT_INVALID", label + "长度不能超过 " + max + "。 ");
        return normalized;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static List<DatabaseDefinition> definitions(List<GovernanceRows.DefinitionRow> rows, String category) {
        return rows.stream().filter(row -> category.equals(row.category))
                .map(OntologyGovernanceRepository::definition).toList();
    }
}
