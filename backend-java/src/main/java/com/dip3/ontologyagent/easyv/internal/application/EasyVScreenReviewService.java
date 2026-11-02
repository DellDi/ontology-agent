package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.semantic.api.InitialObjectSelection;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** 从目录的授权对象直接进入原分析和逐项动作链路。 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class EasyVScreenReviewService {
  private final EasyVObjectReadService objects;
  private final AnalysisService analyses;

  public EasyVScreenReviewService(EasyVObjectReadService objects, AnalysisService analyses) {
    this.objects = objects;
    this.analyses = analyses;
  }

  public String start(AuthSession viewer, String purpose, InitialObjectSelection selection) {
    if (purpose == null || purpose.isBlank() || purpose.strip().length() > 180)
      throw new BackendException("INVALID_ANALYSIS_QUESTION", "请用 1–180 字说明这批大屏的用途与需要保留的内容。");
    for (var ref : selection.references()) {
      if (!"easyv-prototype-layout".equals(ref.objectKey()))
        throw new BackendException("OBJECT_SELECTION_INVALID", "检查范围只能选择大屏原型。");
      var result = objects.browseCatalog(viewer, new EasyVObjectReadService.CatalogRequest(
          selection.datasetVersionSetId(), ref.objectKey(), ref.objectId(), null, null, 1, 0));
      if (!selection.datasetVersionSetId().equals(result.datasetVersionSetId()) || result.page().rows().size() != 1
          || !ref.equals(result.page().rows().getFirst().reference()))
        throw new BackendException("OBJECT_VERSION_MISMATCH", "所选大屏与冻结数据不一致，请重新选择。");
    }
    String question = "请检查所选大屏。用途：" + purpose.strip()
        + "\n逐屏结合主题、模块目的与指标检查内容安排，说明重点问题及依据，为支持的调整准备尚未应用的改造提案；明确无需修改、证据不足或超出能力的部分。";
    return analyses.createObjectSession(viewer, question,
        new CapabilityId(EasyVGenerationOntology.DOMAIN_KEY, EasyVGenerationOntology.CAPABILITY_KEY), selection).id();
  }
}
