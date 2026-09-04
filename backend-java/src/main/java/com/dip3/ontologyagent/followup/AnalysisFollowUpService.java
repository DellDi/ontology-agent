package com.dip3.ontologyagent.followup;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSnapshotEntity;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import java.text.Normalizer;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Owns follow-up records and execution hand-off; domain behavior lives in FollowUpPolicy. */
@Service
public class AnalysisFollowUpService {
  private static final Logger log = LoggerFactory.getLogger(AnalysisFollowUpService.class);
  private final AnalysisService analyses;
  private final AnalysisFollowUpRepository followUps;
  private final OntologyRepository ontologies;
  private final ExecutionRepository executions;
  private final WakeupPublisher wakeups;

  @Autowired
  public AnalysisFollowUpService(
      AnalysisService analyses,
      AnalysisFollowUpRepository followUps,
      OntologyRepository ontologies,
      ExecutionRepository executions,
      WakeupPublisher wakeups) {
    this.analyses = analyses;
    this.followUps = followUps;
    this.ontologies = ontologies;
    this.executions = executions;
    this.wakeups = wakeups;
  }

  AnalysisFollowUpService(
      AnalysisService analyses,
      AnalysisFollowUpRepository followUps,
      OntologyRepository ontologies) {
    this(analyses, followUps, ontologies, null, null);
  }

  @Transactional
  public AnalysisFollowUp create(
      String sessionId, AuthSession owner, String rawQuestion, String parentFollowUpId) {
    AnalysisSession session = analyses.ownedSession(sessionId, owner);
    String question = normalize(rawQuestion);
    if (question.isEmpty()) throw new BackendException("INVALID_FOLLOW_UP_QUESTION", "请输入追问内容。");
    if (question.length() > 300)
      throw new BackendException("INVALID_FOLLOW_UP_QUESTION", "追问长度不能超过 300 个字符。");
    AnalysisFollowUp parent =
        blank(parentFollowUpId) ? null : owned(parentFollowUpId, sessionId, owner);
    ExecutionSnapshotEntity source =
        parent == null
            ? followUps
                .latestCompletedRootSnapshot(sessionId, owner.userId())
                .orElseThrow(
                    () -> new BackendException("FOLLOW_UP_SOURCE_NOT_FOUND", "当前会话没有可承接的已完成根结论。"))
            : parentResult(parent);
    CapabilityBinding sourceBinding = requiredBinding(source.capabilityBinding);
    String ontologyVersionId =
        required(source.ontologyVersionId, "FOLLOW_UP_ONTOLOGY_MISSING", "来源执行没有绑定本体版本，无法发起追问。");
    if (!ontologyVersionId.equals(sourceBinding.ontologyVersionId())) {
      throw new BackendException(
          "FOLLOW_UP_CAPABILITY_BINDING_INVALID", "来源执行的能力绑定与本体版本不一致，无法发起追问。");
    }
    FollowUpPolicy policy = analyses.followUpPolicy(owner, sourceBinding);
    policy.validateQuestion(question);
    Map<String, Object> context = policy.inheritedContext(source.planSnapshot);
    Map<String, Object> mergedContext = policy.applyQuestionContext(question, context, owner);
    Conclusion conclusion = conclusion(source);
    Instant now = Instant.now();
    return followUps.create(
        new AnalysisFollowUp(
            UUID.randomUUID().toString(),
            session.id(),
            owner.userId(),
            question,
            parent == null ? null : parent.id(),
            source.executionId,
            conclusion.title(),
            conclusion.summary(),
            null,
            ontologyVersionId,
            binding(ontologyVersionId, "inherited"),
            sourceBinding.snapshot(),
            context,
            mergedContext,
            null,
            null,
            null,
            null,
            now,
            now));
  }

  public List<AnalysisFollowUp> list(String sessionId, AuthSession owner) {
    analyses.ownedSession(sessionId, owner);
    return followUps.listOwned(sessionId, owner.userId());
  }

  public AnalysisFollowUp get(String sessionId, String followUpId, AuthSession owner) {
    analyses.ownedSession(sessionId, owner);
    return owned(followUpId, sessionId, owner);
  }

  @Transactional
  public AdjustmentResult adjust(
      String sessionId,
      String followUpId,
      AuthSession owner,
      Map<String, String> draft,
      boolean confirmConflicts) {
    AnalysisFollowUp current = get(sessionId, followUpId, owner);
    rejectSubmittedMutation(current);
    try {
      FollowUpPolicy.FollowUpAdjustment result =
          policy(owner, current)
              .adjust(current.inheritedContext(), current.mergedContext(), draft, confirmConflicts);
      boolean changed = !Objects.equals(result.mergedContext(), current.mergedContext());
      Instant now = Instant.now();
      AnalysisFollowUp next =
          new AnalysisFollowUp(
              current.id(),
              current.sessionId(),
              current.ownerUserId(),
              current.questionText(),
              current.parentFollowUpId(),
              current.referencedExecutionId(),
              current.referencedConclusionTitle(),
              current.referencedConclusionSummary(),
              current.resultExecutionId(),
              current.ontologyVersionId(),
              current.ontologyVersionBinding(),
              current.capabilityBinding(),
              current.inheritedContext(),
              result.mergedContext(),
              changed ? null : current.planVersion(),
              changed ? null : current.currentPlanSnapshot(),
              changed ? null : current.previousPlanSnapshot(),
              changed ? null : current.currentPlanDiff(),
              current.createdAt(),
              now);
      return new AdjustmentResult(followUps.replace(current, next), result.diff());
    } catch (FollowUpPolicy.ConflictException error) {
      throw new FollowUpConflictException(error.conflicts());
    }
  }

  @Transactional
  public AnalysisFollowUp replan(String sessionId, String followUpId, AuthSession owner) {
    AnalysisFollowUp current = get(sessionId, followUpId, owner);
    rejectSubmittedMutation(current);
    ExecutionSnapshotEntity source =
        followUps
            .completedSourceSnapshot(current)
            .orElseThrow(
                () -> new BackendException("FOLLOW_UP_SOURCE_NOT_FOUND", "来源执行已失效或不再是已完成状态。"));
    if (source.planSnapshot == null || source.planSnapshot.isEmpty()) {
      throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "缺少上一轮计划快照，无法重规划。");
    }
    Map<String, Object> previous =
        current.currentPlanSnapshot() == null
            ? Map.copyOf(source.planSnapshot)
            : current.currentPlanSnapshot();
    Map<String, Object> nextPlan =
        policy(owner, current)
            .replan(
                previous,
                current.inheritedContext(),
                current.mergedContext(),
                owner,
                current.id(),
                current.referencedExecutionId());
    Map<String, Object> diff = planDiff(previous, nextPlan);
    int version = current.planVersion() == null ? 2 : current.planVersion() + 1;
    AnalysisFollowUp next =
        new AnalysisFollowUp(
            current.id(),
            current.sessionId(),
            current.ownerUserId(),
            current.questionText(),
            current.parentFollowUpId(),
            current.referencedExecutionId(),
            current.referencedConclusionTitle(),
            current.referencedConclusionSummary(),
            current.resultExecutionId(),
            current.ontologyVersionId(),
            current.ontologyVersionBinding(),
            current.capabilityBinding(),
            current.inheritedContext(),
            current.mergedContext(),
            version,
            nextPlan,
            previous,
            diff,
            current.createdAt(),
            Instant.now());
    return followUps.replace(current, next);
  }

  @Transactional
  public AnalysisFollowUp attachResultExecution(
      String sessionId,
      String followUpId,
      AuthSession owner,
      String executionId,
      String ontologyVersionId) {
    return attach(get(sessionId, followUpId, owner), executionId, ontologyVersionId);
  }

  private AnalysisFollowUp attach(
      AnalysisFollowUp current, String executionId, String ontologyVersionId) {
    if (!current.ontologyVersionId().equals(ontologyVersionId))
      throw new BackendException("FOLLOW_UP_ONTOLOGY_MISMATCH", "追问执行绑定的本体版本与当前计划不一致。");
    if (current.resultExecutionId() != null) {
      if (current.resultExecutionId().equals(executionId)) return current;
      throw new BackendException("FOLLOW_UP_EXECUTION_CONFLICT", "该追问已绑定其他执行。");
    }
    AnalysisFollowUp next =
        new AnalysisFollowUp(
            current.id(),
            current.sessionId(),
            current.ownerUserId(),
            current.questionText(),
            current.parentFollowUpId(),
            current.referencedExecutionId(),
            current.referencedConclusionTitle(),
            current.referencedConclusionSummary(),
            executionId,
            current.ontologyVersionId(),
            current.ontologyVersionBinding(),
            current.capabilityBinding(),
            current.inheritedContext(),
            current.mergedContext(),
            current.planVersion(),
            current.currentPlanSnapshot(),
            current.previousPlanSnapshot(),
            current.currentPlanDiff(),
            current.createdAt(),
            Instant.now());
    return followUps.replace(current, next);
  }

  @Transactional
  public String submit(
      String sessionId,
      String followUpId,
      AuthSession owner,
      String idempotencyKey,
      String traceId) {
    if (executions == null || wakeups == null)
      throw new BackendException("FOLLOW_UP_EXECUTION_UNAVAILABLE", "追问执行组件未配置。");
    AnalysisSession session = analyses.ownedSession(sessionId, owner);
    AnalysisFollowUp followUp =
        followUps
            .lockOwned(followUpId, sessionId, owner.userId())
            .orElseThrow(() -> new BackendException("FOLLOW_UP_NOT_FOUND", "追问不存在或无权访问。"));
    ontologies.published(followUp.ontologyVersionId());
    if (followUp.resultExecutionId() != null) return followUp.resultExecutionId();
    if (!followUp.mergedContext().equals(followUp.inheritedContext())
        && followUp.currentPlanSnapshot() == null) {
      throw new BackendException("FOLLOW_UP_REPLAN_REQUIRED", "追问上下文已变更，请先完成重规划再执行。");
    }
    if (!TransactionSynchronizationManager.isSynchronizationActive())
      throw new BackendException("FOLLOW_UP_TRANSACTION_REQUIRED", "追问提交必须运行在事务中。");
    CapabilityBinding persistedBinding = requiredBinding(followUp.capabilityBinding());
    if (!followUp.ontologyVersionId().equals(persistedBinding.ontologyVersionId()))
      throw new BackendException("FOLLOW_UP_CAPABILITY_BINDING_INVALID", "追问的能力绑定与追问本体版本不一致。");
    analyses.validateCapabilityBinding(owner, persistedBinding);
    Map<String, Object> effectiveContext =
        analyses
            .followUpPolicy(owner, persistedBinding)
            .executableContext(followUp.currentPlanSnapshot(), followUp.mergedContext());
    String key =
        idempotencyKey == null || idempotencyKey.isBlank() ? "follow-up" : idempotencyKey.trim();
    if (key.length() > 128)
      throw new BackendException("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 不能超过 128 个字符。");
    ExecutionSubmission submission =
        executions.submitFollowUp(
            session,
            followUp.id(),
            followUp.referencedExecutionId(),
            followUp.questionText(),
            Map.of(
                "title",
                followUp.referencedConclusionTitle() == null
                    ? ""
                    : followUp.referencedConclusionTitle(),
                "summary",
                followUp.referencedConclusionSummary() == null
                    ? ""
                    : followUp.referencedConclusionSummary()),
            effectiveContext,
            key,
            traceId,
            persistedBinding);
    attach(followUp, submission.executionId(), followUp.ontologyVersionId());
    if (submission.created()) publishAfterCommit(submission.executionId(), traceId);
    return submission.executionId();
  }

  private FollowUpPolicy policy(AuthSession owner, AnalysisFollowUp followUp) {
    return analyses.followUpPolicy(owner, requiredBinding(followUp.capabilityBinding()));
  }

  private static CapabilityBinding requiredBinding(Map<String, Object> raw) {
    if (raw == null || raw.equals(CapabilityBinding.legacySnapshot()))
      throw new BackendException(
          "FOLLOW_UP_CAPABILITY_BINDING_MISSING", "来源执行没有可复用的能力绑定，不能重新选择能力执行。");
    try {
      return CapabilityBinding.fromSnapshot(raw);
    } catch (IllegalArgumentException error) {
      throw new BackendException(
          "FOLLOW_UP_CAPABILITY_BINDING_INVALID", "来源执行的能力绑定无效，无法发起追问。", error);
    }
  }

  private void publishAfterCommit(String executionId, String traceId) {
    if (!TransactionSynchronizationManager.isSynchronizationActive())
      throw new BackendException("FOLLOW_UP_TRANSACTION_REQUIRED", "追问提交必须运行在事务中。");
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            try {
              wakeups.publish(executionId);
              executions.markDispatchPublished(executionId);
            } catch (RuntimeException error) {
              try {
                executions.markDispatchFailed(executionId);
              } catch (RuntimeException persistenceError) {
                error.addSuppressed(persistenceError);
              }
              log.error(
                  "follow_up_wakeup_failed executionId={} traceId={} message={}",
                  executionId,
                  traceId,
                  error.getMessage(),
                  error);
            }
          }
        });
  }

  private ExecutionSnapshotEntity parentResult(AnalysisFollowUp parent) {
    String executionId =
        required(
            parent.resultExecutionId(), "FOLLOW_UP_PARENT_NOT_COMPLETED", "父追问还没有已完成结果，无法继续承接。");
    return followUps
        .completedFollowUpSnapshot(
            executionId, parent.sessionId(), parent.ownerUserId(), parent.id())
        .orElseThrow(
            () -> new BackendException("FOLLOW_UP_PARENT_NOT_COMPLETED", "父追问结果不存在或尚未完成，无法继续承接。"));
  }

  private AnalysisFollowUp owned(String id, String sessionId, AuthSession owner) {
    AnalysisFollowUp f =
        followUps
            .findOwned(id, owner.userId())
            .orElseThrow(() -> new BackendException("FOLLOW_UP_NOT_FOUND", "追问不存在或无权访问。"));
    if (!sessionId.equals(f.sessionId()))
      throw new BackendException("FOLLOW_UP_NOT_FOUND", "追问不存在或无权访问。");
    return f;
  }

  private static void rejectSubmittedMutation(AnalysisFollowUp f) {
    if (f.resultExecutionId() != null)
      throw new BackendException(
          "FOLLOW_UP_ALREADY_SUBMITTED", "该追问已提交执行，不能改写历史输入；请基于完成结果创建下一轮追问。");
  }

  private static Conclusion conclusion(ExecutionSnapshotEntity s) {
    Object causes = s.conclusionState == null ? null : s.conclusionState.get("causes");
    if (!(causes instanceof List<?> l) || l.isEmpty() || !(l.getFirst() instanceof Map<?, ?> c))
      throw new BackendException("FOLLOW_UP_CONCLUSION_MISSING", "来源执行缺少可承接结论。");
    String title = text(c.get("title")), summary = text(c.get("summary"));
    if (blank(title) && blank(summary))
      throw new BackendException("FOLLOW_UP_CONCLUSION_MISSING", "来源执行缺少可承接结论。");
    return new Conclusion(title, summary);
  }

  private static Map<String, Object> planDiff(
      Map<String, Object> previous, Map<String, Object> next) {
    Object steps = previous.get("steps");
    if (!(steps instanceof List<?> list))
      throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤无效，无法重规划。");
    List<Map<String, Object>> invalidated =
        list.stream()
            .map(
                i -> {
                  Map<?, ?> s = (Map<?, ?>) i;
                  return Map.<String, Object>of(
                      "stepId",
                      required(text(s.get("id")), "FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤缺少 id。"),
                      "title",
                      required(
                          text(s.get("title")), "FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤缺少 title。"),
                      "reason",
                      "追问上下文已变更，需要重新执行。");
                })
            .toList();
    return Map.of(
        "reason",
        "用户追问或纠正后的上下文触发计划重算。",
        "reusedSteps",
        List.of(),
        "invalidatedSteps",
        invalidated,
        "addedSteps",
        List.of());
  }

  private static Map<String, Object> binding(String ontology, String source) {
    return Map.of("ontologyVersionId", ontology, "source", source);
  }

  private static String normalize(String v) {
    return v == null
        ? ""
        : Normalizer.normalize(v, Normalizer.Form.NFKC).replaceAll("[\\s\\u3000]+", " ").trim();
  }

  private static String text(Object v) {
    return v == null ? null : v.toString();
  }

  private static boolean blank(String v) {
    return v == null || v.isBlank();
  }

  private static String required(String v, String code, String msg) {
    if (blank(v)) throw new BackendException(code, msg);
    return v;
  }

  public record AdjustmentResult(AnalysisFollowUp followUp, Map<String, Object> diff) {}

  private record Conclusion(String title, String summary) {}

  public static final class FollowUpConflictException extends RuntimeException {
    private final List<Map<String, Object>> conflicts;

    public FollowUpConflictException(List<Map<String, Object>> conflicts) {
      super("发现冲突条件，确认后才会覆盖当前轮次上下文。");
      this.conflicts = List.copyOf(conflicts);
    }

    public List<Map<String, Object>> conflicts() {
      return conflicts;
    }
  }
}
