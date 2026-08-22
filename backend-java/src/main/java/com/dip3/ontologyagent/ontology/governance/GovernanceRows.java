package com.dip3.ontologyagent.ontology.governance;

import java.time.Instant;
import java.util.Map;

public final class GovernanceRows {
    private GovernanceRows() {}

    public static final class VersionRow {
        public String id, semver, displayName, status, description, createdBy;
        public Instant publishedAt, deprecatedAt, retiredAt, createdAt, updatedAt;
    }

    public static final class ChangeRequestRow {
        public String id, ontologyVersionId, targetObjectType, targetObjectKey, changeType, status, title,
                description, compatibilityType, compatibilityNote, submittedBy;
        public Map<String, Object> beforeSummary, afterSummary;
        public String[] impactScope;
        public Instant submittedAt, createdAt, updatedAt;
    }

    public static final class ApprovalRow {
        public String id, changeRequestId, decision, reviewedBy, comment;
        public Instant createdAt;
    }

    public static final class PublishRow {
        public String id, ontologyVersionId, publishedBy, previousVersionId, publishNote;
        public String[] changeRequestIds;
        public Instant createdAt;
    }

    public static final class DefinitionRow {
        public String category, id, ontologyVersionId, businessKey, displayName, description, status;
        public Map<String, Object> fields;
        public Instant createdAt, updatedAt;
    }
}
