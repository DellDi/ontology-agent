package com.dip3.ontologyagent.capability.api;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.Map;

/** Follow-up behavior owned by a capability, exposed without leaking its domain model. */
public interface FollowUpPolicy {
  static FollowUpPolicy unsupported() {
    return new FollowUpPolicy() {
      private BackendException unavailable() {
        return new BackendException("FOLLOW_UP_POLICY_UNAVAILABLE", "任务绑定的分析能力未提供追问策略。");
      }

      @Override
      public void validateQuestion(String question) {
        throw unavailable();
      }

      @Override
      public Map<String, Object> inheritedContext(Map<String, Object> sourcePlan) {
        throw unavailable();
      }

      @Override
      public Map<String, Object> applyQuestionContext(
          String question, Map<String, Object> inheritedContext, AuthSession principal) {
        throw unavailable();
      }

      @Override
      public FollowUpAdjustment adjust(
          Map<String, Object> inheritedContext,
          Map<String, Object> mergedContext,
          Map<String, String> draft,
          boolean confirmConflicts) {
        throw unavailable();
      }

      @Override
      public Map<String, Object> replan(
          Map<String, Object> previousPlan,
          Map<String, Object> inheritedContext,
          Map<String, Object> mergedContext,
          AuthSession principal,
          String followUpId,
          String referencedExecutionId) {
        throw unavailable();
      }

      @Override
      public Map<String, Object> executableContext(
          Map<String, Object> sourcePlan, Map<String, Object> currentPlan, Map<String, Object> mergedContext) {
        throw unavailable();
      }

      @Override
      public Map<String, Object> structuredPlan(
          Map<String, Object> sourcePlan, List<Map<String, Object>> queries) {
        throw unavailable();
      }
    };
  }

  void validateQuestion(String question);

  Map<String, Object> inheritedContext(Map<String, Object> sourcePlan);

  Map<String, Object> applyQuestionContext(
      String question, Map<String, Object> inheritedContext, AuthSession principal);

  FollowUpAdjustment adjust(
      Map<String, Object> inheritedContext,
      Map<String, Object> mergedContext,
      Map<String, String> draft,
      boolean confirmConflicts);

  Map<String, Object> replan(
      Map<String, Object> previousPlan,
      Map<String, Object> inheritedContext,
      Map<String, Object> mergedContext,
      AuthSession principal,
      String followUpId,
      String referencedExecutionId);

  /** 选择是能力自己的业务输入；返回只能收窄的执行范围。 */
  default ResolvedScopeSnapshot validateObjectSelection(AuthSession principal, CapabilityBinding binding,
                                                       ObjectSelection selection) {
    throw new BackendException("OBJECT_SELECTION_UNSUPPORTED", "当前分析能力不支持对象选择追问。");
  }

  /**
   * 结构化调整：把用户编辑后的查询意图直接编译为新的执行计划，不经模型规划。
   * 默认不支持；支持结构化调整的能力覆盖此方法。
   */
  default Map<String, Object> structuredPlan(
      Map<String, Object> sourcePlan, List<Map<String, Object>> queries) {
    throw new BackendException("FOLLOW_UP_STRUCTURED_UNSUPPORTED", "该分析能力不支持结构化调整。");
  }

  /**
   * @param sourcePlan 被追问的已完成执行的计划快照
   * @param currentPlan 重规划后的当前计划，未重规划时为空
   */
  Map<String, Object> executableContext(
      Map<String, Object> sourcePlan, Map<String, Object> currentPlan, Map<String, Object> mergedContext);

  record FollowUpAdjustment(Map<String, Object> mergedContext, Map<String, Object> diff) {
    public FollowUpAdjustment {
      mergedContext = Map.copyOf(mergedContext);
      diff = Map.copyOf(diff);
    }
  }

  final class ConflictException extends RuntimeException {
    private final List<Map<String, Object>> conflicts;

    public ConflictException(List<Map<String, Object>> conflicts) {
      super("发现冲突条件，确认后才会覆盖当前轮次上下文。");
      this.conflicts = List.copyOf(conflicts);
    }

    public List<Map<String, Object>> conflicts() {
      return conflicts;
    }
  }
}
