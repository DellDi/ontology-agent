package com.dip3.ontologyagent.semantic.api;

import java.time.LocalDate;

/**
 * 解析后的闭区间业务日期；allData 时 from 为 null（下界不限），to 为锚点日期。
 */
public record ResolvedTimeRange(LocalDate from, LocalDate to, boolean allData, String sourceText) {

  public String description() {
    if (allData) return "全部数据（截至 " + to + "）";
    return sourceText + "（" + from + " 至 " + to + "）";
  }

  /** 与冻结数据中该时间属性的实际覆盖区间求交。 */
  public TimeCoverage coverage(LocalDate dataFrom, LocalDate dataTo) {
    if (dataFrom == null || dataTo == null) return TimeCoverage.none();
    LocalDate lower = allData ? dataFrom : max(from, dataFrom);
    LocalDate upper = to.isBefore(dataTo) ? to : dataTo;
    if (lower.isAfter(upper)) return TimeCoverage.none();
    boolean full = allData || (!from.isBefore(dataFrom) && !to.isAfter(dataTo));
    return new TimeCoverage(full ? TimeCoverage.Status.FULL : TimeCoverage.Status.PARTIAL, lower, upper);
  }

  private static LocalDate max(LocalDate left, LocalDate right) {
    return left.isAfter(right) ? left : right;
  }
}
