package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.execution.ExecutionEvent;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSnapshot;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import java.text.Normalizer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public final class AnalysisService {
  private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
  private final AnalysisSessionRepository sessions;
  private final ExecutionRepository executions;
  private final WakeupPublisher wakeups;
  private final OntologyRepository ontologies;
  private final CapabilityRegistry capabilities;
  private final DatasetVersionSetRegistry datasetVersionSets;

  public AnalysisService(
      AnalysisSessionRepository sessions,
      ExecutionRepository executions,
      WakeupPublisher wakeups,
      OntologyRepository ontologies,
      CapabilityRegistry capabilities,
      DatasetVersionSetRegistry datasetVersionSets) {
    this.sessions = sessions;
    this.executions = executions;
    this.wakeups = wakeups;
    this.ontologies = ontologies;
    this.capabilities = capabilities;
    this.datasetVersionSets = datasetVersionSets;
  }

  public AnalysisSession createSession(AuthSession owner, String rawQuestion) {
    String question =
        rawQuestion == null
            ? ""
            : Normalizer.normalize(rawQuestion, Normalizer.Form.NFKC)
                .replaceAll("[\\s\\u3000]+", " ")
                .trim();
    if (question.isEmpty()) throw new BackendException("INVALID_ANALYSIS_QUESTION", "请输入要分析的问题。");
    if (question.length() > 300)
      throw new BackendException("INVALID_ANALYSIS_QUESTION", "问题长度不能超过 300 个字符。");
    CapabilityId capabilityId = capabilities.selectInitial(question);
    return sessions.create(owner, question, initialContext(capabilityId));
  }

  public String submit(String sessionId, AuthSession owner, String idempotencyKey, String traceId) {
    AnalysisSession session = ownedSession(sessionId, owner);
    if (!ExecutionRepository.EXECUTION_CONTRACT.equals(
        session.savedContext().get("_executionContract"))) {
      throw new BackendException("LEGACY_EXECUTION_NOT_MIGRATED", "该会话由旧后端创建，本切片不会自动或手动重跑首次分析。");
    }
    var ontology = ontologies.currentPublished();
    CapabilityBinding binding =
        capabilities.bind(capabilityId(session.savedContext()), ontology, owner);
    CapabilityDescriptor descriptor = capabilities.require(binding, ontology, owner);
    String datasetVersionSetId = latestDatasetVersionSet(descriptor);
    String key = normalizeIdempotencyKey(idempotencyKey);
    ExecutionSubmission submission = datasetVersionSetId == null
        ? executions.submit(session, key, traceId, binding)
        : executions.submit(session, key, traceId, binding, datasetVersionSetId);
    if (!submission.created()) return submission.executionId();
    try {
      wakeups.publish(submission.executionId());
      executions.markDispatchPublished(submission.executionId());
    } catch (RuntimeException error) {
      executions.markDispatchFailed(submission.executionId());
      log.warn(
          "redis_wakeup_failed executionId={} traceId={} message={}",
          submission.executionId(),
          traceId,
          error.getMessage(),
          error);
    }
    return submission.executionId();
  }

  /** Resolves the policy for a persisted capability binding; never selects a new capability. */
  public FollowUpPolicy followUpPolicy(AuthSession owner, CapabilityBinding binding) {
    if (binding == null) {
      throw new BackendException(
          "FOLLOW_UP_CAPABILITY_BINDING_MISSING", "来源执行没有可复用的能力绑定，不能重新选择能力执行。");
    }
    return capabilities.requireFollowUpPolicy(
        binding, ontologies.published(binding.ontologyVersionId()), owner);
  }

  /** Revalidates a persisted binding without selecting a new capability or scope. */
  public void validateCapabilityBinding(AuthSession owner, CapabilityBinding binding) {
    if (binding == null) {
      throw new BackendException("CAPABILITY_BINDING_INVALID", "执行任务缺少能力绑定。");
    }
    capabilities.require(binding, ontologies.published(binding.ontologyVersionId()), owner);
  }

  /** Validates an inherited execution data binding without selecting newer product versions. */
  public void validateDatasetVersionSet(
      AuthSession owner, CapabilityBinding binding, String datasetVersionSetId) {
    if (binding == null) {
      throw new BackendException("CAPABILITY_BINDING_INVALID", "执行任务缺少能力绑定。");
    }
    var ontology = ontologies.published(binding.ontologyVersionId());
    CapabilityDescriptor descriptor = capabilities.require(binding, ontology, owner);
    if (descriptor.requiredDataProductKeys().isEmpty()) {
      if (datasetVersionSetId != null) {
        throw new BackendException("DATASET_VERSION_SET_UNEXPECTED", "当前能力不声明 canonical 数据产品。");
      }
      return;
    }
    if (datasetVersionSetId == null) {
      throw new BackendException("DATASET_VERSION_SET_MISSING",
          "来源执行没有冻结的数据版本集合，不能保证事实可复核。");
    }
    datasetVersionSets.requireFrozen(datasetVersionSetId, descriptor.requiredDataProductKeys());
  }

  public AnalysisSession ownedSession(String sessionId, AuthSession owner) {
    return sessions
        .findOwned(sessionId, owner)
        .orElseThrow(() -> new BackendException("SESSION_NOT_FOUND", "会话不存在或无权访问。"));
  }

  public List<ExecutionEvent> events(
      String sessionId, String executionId, AuthSession owner, long afterSequence) {
    ownedSession(sessionId, owner);
    boolean exists =
        executions.findOwnedJavaJob(sessionId, executionId, owner.userId()).isPresent()
            || executions.findJavaSnapshot(sessionId, executionId, owner.userId()).isPresent();
    if (!exists) throw new BackendException("EXECUTION_NOT_FOUND", "执行不存在或无权访问。");
    return executions.listAfter(sessionId, executionId, owner.userId(), afterSequence);
  }

  public Optional<ExecutionSnapshot> snapshot(
      String sessionId, String executionId, AuthSession owner) {
    ownedSession(sessionId, owner);
    return executions.findJavaSnapshot(sessionId, executionId, owner.userId());
  }

  private static String normalizeIdempotencyKey(String key) {
    if (key == null || key.isBlank()) return "initial";
    String normalized = key.trim();
    if (normalized.length() > 128) {
      throw new BackendException("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 不能超过 128 个字符。");
    }
    return normalized;
  }

  private String latestDatasetVersionSet(CapabilityDescriptor descriptor) {
    if (descriptor.requiredDataProductKeys().isEmpty()) return null;
    return datasetVersionSets.latestFrozen(descriptor.requiredDataProductKeys())
        .orElseThrow(() -> new BackendException("DATASET_VERSION_SET_NOT_PUBLISHED",
            "当前能力尚无包含全部所需数据产品的已冻结版本集合。"))
        .publicationId();
  }

  private static Map<String, Object> initialContext(CapabilityId capabilityId) {
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("_executionContract", ExecutionRepository.EXECUTION_CONTRACT);
    context.put(
        "_capabilityId",
        Map.of("domainKey", capabilityId.domainKey(), "capabilityKey", capabilityId.capabilityKey()));
    context.put("targetMetric", field("目标指标"));
    context.put("entity", field("分析对象"));
    context.put("timeRange", field("时间范围"));
    context.put("comparison", field("比较基线"));
    context.put("constraints", List.of());
    return context;
  }

  private static CapabilityId capabilityId(Map<String, Object> savedContext) {
    Object raw = savedContext == null ? null : savedContext.get("_capabilityId");
    if (!(raw instanceof Map<?, ?> values)
        || values.keySet().stream().anyMatch(key -> !(key instanceof String))) {
      throw new BackendException("CAPABILITY_SELECTION_MISSING", "会话缺少已确认的分析能力选择，不能提交执行。");
    }
    if (!values.keySet().equals(java.util.Set.of("domainKey", "capabilityKey"))) {
      throw new BackendException("CAPABILITY_SELECTION_INVALID", "会话中的分析能力选择字段无效，不能提交执行。");
    }
    try {
      return new CapabilityId(requiredText(values, "domainKey"), requiredText(values, "capabilityKey"));
    } catch (IllegalArgumentException error) {
      throw new BackendException("CAPABILITY_SELECTION_INVALID", "会话中的分析能力选择无效，不能提交执行。", error);
    }
  }

  private static String requiredText(Map<?, ?> values, String key) {
    Object value = values.get(key);
    if (!(value instanceof String text) || text.isBlank()) {
      throw new IllegalArgumentException(key + " must be a non-blank string");
    }
    return text;
  }

  private static Map<String, Object> field(String label) {
    return Map.of("label", label, "value", "待由 Agent 基于已发布本体确认", "state", "missing");
  }
}
