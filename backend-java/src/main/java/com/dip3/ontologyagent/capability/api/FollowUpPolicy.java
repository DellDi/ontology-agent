package com.dip3.ontologyagent.capability.api;

import com.dip3.ontologyagent.auth.AuthSession;
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
          Map<String, Object> currentPlan, Map<String, Object> mergedContext) {
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

  Map<String, Object> executableContext(
      Map<String, Object> currentPlan, Map<String, Object> mergedContext);

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
