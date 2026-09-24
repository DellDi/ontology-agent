package com.dip3.ontologyagent.semantic.api;

import java.time.LocalDate;

/** 请求区间与数据覆盖区间的关系；effective 为实际可回答的闭区间，NONE 时为空。 */
public record TimeCoverage(Status status, LocalDate effectiveFrom, LocalDate effectiveTo) {

  public enum Status { FULL, PARTIAL, NONE }

  static TimeCoverage none() {
    return new TimeCoverage(Status.NONE, null, null);
  }
}
