package com.dip3.ontologyagent.ontology.governance;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class GovernanceResponses {
    private GovernanceResponses() {}

    public record OntologyVersionSummary(String id, String semver, String displayName, String status,
                                         String description, Instant publishedAt, Instant deprecatedAt,
                                         Instant retiredAt, String createdBy, Instant createdAt, Instant updatedAt) {}

    public record OntologyChangeRequest(String id, String ontologyVersionId, String targetObjectType,
                                        String targetObjectKey, String changeType, String status, String title,
                                        String description, Map<String, Object> beforeSummary,
                                        Map<String, Object> afterSummary, List<String> impactScope,
                                        String compatibilityType, String compatibilityNote, String submittedBy,
                                        Instant submittedAt, Instant createdAt, Instant updatedAt) {}

    public record OntologyApprovalRecord(String id, String changeRequestId, String decision, String reviewedBy,
                                         String comment, Instant createdAt) {}

    public record OntologyPublishRecord(String id, String ontologyVersionId, String publishedBy,
                                        String previousVersionId, List<String> changeRequestIds, String publishNote,
                                        Instant createdAt) {}

    public record GovernanceOverview(OntologyVersionSummary currentPublishedVersion,
                                     OntologyVersionSummary latestApprovedVersion, long pendingReviewCount,
                                     long approvedAwaitingPublishCount,
                                     List<OntologyChangeRequest> recentChangeRequests,
                                     List<OntologyPublishRecord> recentPublishes,
                                     GovernanceCapabilities capabilities) {}

    public record ChangeRequestList(List<OntologyChangeRequest> items, GovernanceCapabilities capabilities) {}
    public record ChangeRequestDetail(OntologyChangeRequest changeRequest,
                                      List<OntologyApprovalRecord> approvals,
                                      GovernanceCapabilities capabilities) {}
    public record PublishHistory(List<OntologyPublishRecord> items, GovernanceCapabilities capabilities) {}
    public record VersionList(List<OntologyVersionSummary> items, GovernanceCapabilities capabilities) {}
    public record ReviewResult(OntologyChangeRequest changeRequest, OntologyApprovalRecord approvalRecord) {}

    public record DatabaseDefinition(String id, String ontologyVersionId, String businessKey,
                                     String displayName, String description, String status,
                                     Map<String, Object> fields, Instant createdAt, Instant updatedAt) {}

    public record GovernanceDefinitions(OntologyVersionSummary version,
                                        List<DatabaseDefinition> entities,
                                        List<DatabaseDefinition> metrics,
                                        List<DatabaseDefinition> metricVariants,
                                        List<DatabaseDefinition> factors,
                                        List<DatabaseDefinition> causalityEdges,
                                        List<DatabaseDefinition> planStepTemplates,
                                        List<DatabaseDefinition> toolBindings,
                                        List<DatabaseDefinition> timeSemantics,
                                        List<DatabaseDefinition> evidenceTypes,
                                        GovernanceCapabilities capabilities) {}

    public record CreateChangeRequest(String ontologyVersionId, String targetObjectType, String targetObjectKey,
                                      String changeType, String title, String description,
                                      Map<String, Object> beforeSummary, Map<String, Object> afterSummary,
                                      List<String> impactScope, String compatibilityType, String compatibilityNote) {}
    public record ReviewChangeRequest(String decision, String comment) {}
    public record PublishVersion(String publishNote) {}
}
