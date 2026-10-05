package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.MetricBinding;
import com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation;
import java.util.List;

/** 调用方必须先完成冻结对象授权；适配器只读取指定版本并保存本次评估证据。 */
public interface SchemeAssessmentPort {
  record Block(String blockTypeId, String schemeId, Boolean titlePresent, String metricBindingStatus,
      List<MetricBinding> metrics, List<SchemeAdaptation.Component> components) {}
  Block block(String blockVersionId, String componentVersionId, String appId, String blockId);
  List<SchemeAdaptation.Candidate> candidates(String schemeVersionId, String blockTypeId);
  void audit(String assessmentId, String sessionId, AuthSession viewer, Object evidence);
}
