package com.dip3.ontologyagent.easyv.internal.domain;

/** 比较的是两份可见快照，不推断两次采集之间的过程或失败根因。 */
public enum FailureChange {
  CHANGED_TO_FAILED, FIRST_VISIBLE_FAILURE, FAILED_IN_BOTH, NO_BASELINE;

  public static FailureChange classify(boolean hasBaseline, String previousStatus) {
    if (!hasBaseline) return NO_BASELINE;
    if (previousStatus == null) return FIRST_VISIBLE_FAILURE;
    return "failed".equals(previousStatus) ? FAILED_IN_BOTH : CHANGED_TO_FAILED;
  }
}
