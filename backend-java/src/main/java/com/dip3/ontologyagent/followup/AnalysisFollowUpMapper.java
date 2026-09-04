package com.dip3.ontologyagent.followup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.time.Instant;

@Mapper
public interface AnalysisFollowUpMapper extends BaseMapper<AnalysisFollowUpEntity> {
    @Update("""
            update platform.analysis_session_follow_ups
            set question_text=#{row.questionText},parent_follow_up_id=#{row.parentFollowUpId},
                referenced_execution_id=#{row.referencedExecutionId},
                referenced_conclusion_title=#{row.referencedConclusionTitle},
                referenced_conclusion_summary=#{row.referencedConclusionSummary},
                result_execution_id=#{row.resultExecutionId},ontology_version_id=#{row.ontologyVersionId},
                ontology_version_binding_source=#{row.ontologyVersionBindingSource},
                capability_binding=#{row.capabilityBinding,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                inherited_context=#{row.inheritedContext,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                merged_context=#{row.mergedContext,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                plan_version=#{row.planVersion},
                current_plan_snapshot=#{row.currentPlanSnapshot,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                previous_plan_snapshot=#{row.previousPlanSnapshot,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                current_plan_diff=#{row.currentPlanDiff,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                updated_at=#{row.updatedAt}
            where id=#{row.id} and session_id=#{row.sessionId} and owner_user_id=#{row.ownerUserId}
              and updated_at=#{expectedUpdatedAt}
            """)
    int replace(@Param("row") AnalysisFollowUpEntity row,
                @Param("expectedUpdatedAt") Instant expectedUpdatedAt);
}
