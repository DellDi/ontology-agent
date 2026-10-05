package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.application.SchemeAssessmentPort;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.support.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(prefix="dip3.easyv", name="enabled", havingValue="true")
public class SchemeAssessmentPostgresAdapter implements SchemeAssessmentPort {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final TypeReference<List<PrototypeStructureParser.MetricBinding>> METRICS = new TypeReference<>() {};
  private static final TypeReference<List<SchemeLibraryParser.Slot>> SLOTS = new TypeReference<>() {};
  private static final TypeReference<PrototypeComponentGeometry.Parsed> GEOMETRY = new TypeReference<>() {};
  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  public SchemeAssessmentPostgresAdapter(JdbcTemplate jdbc, JsonCodec json) { this.jdbc=jdbc;this.json=json; }
  @Override public Block block(String blockVersionId,String componentVersionId,String appId,String blockId) {
    var block=jdbc.queryForObject("""
        select block_type_id,scheme_id,title_present,metric_binding_status,metric_bindings
        from facts.easyv_prototype_block where product_version_id=? and app_id=? and block_id=?
        """,(rs,index) -> new Block(rs.getString(1),rs.getString(2),(Boolean)rs.getObject(3),rs.getString(4),decode(rs.getString(5),METRICS),null),blockVersionId,appId,blockId);
    var components=jdbc.query("""
        select component_id,geometry from facts.easyv_prototype_component
        where product_version_id=? and app_id=? and block_id=? order by component_id
        """,(rs,index) -> new SchemeAdaptation.Component(rs.getString(1),decode(rs.getString(2),GEOMETRY)),componentVersionId,appId,blockId);
    if (block.metrics()!=null) {
      Map<String,SchemeAdaptation.Component> byId=new HashMap<>();components.forEach(c -> byId.put(c.componentId(),c));
      if (components.size()==block.metrics().size() && block.metrics().stream().allMatch(m -> byId.containsKey(m.componentId())))
        components=block.metrics().stream().map(m -> byId.get(m.componentId())).toList();
    }
    return new Block(block.blockTypeId(),block.schemeId(),block.titlePresent(),block.metricBindingStatus(),block.metrics(),components);
  }
  @Override public List<SchemeAdaptation.Candidate> candidates(String version,String blockType) {
    var result=jdbc.query("""
        select source_id::text,block_type_id,chart_count,parse_status,parse_error_code,slots
        from facts.easyv_scheme_library where product_version_id=? and block_type_id=?
        order by source_id limit 201
        """,(rs,index) -> new SchemeAdaptation.Candidate(rs.getString(1),rs.getString(2),rs.getInt(3),rs.getString(4),rs.getString(5),decode(rs.getString(6),SLOTS)),version,blockType);
    if(result.size()>200) throw new BackendException("SCHEME_CANDIDATE_LIMIT_EXCEEDED","冻结方案库的同类候选超过 200 项；需要收窄候选范围后评估。");
    return result;
  }
  @Override public void audit(String id,String sessionId,AuthSession viewer,Object evidence) {
    jdbc.update("""
        insert into platform.audit_events(id,user_id,organization_id,session_id,event_type,event_result,
          event_source,correlation_id,payload,created_at,retention_until)
        values(?,?,?,?,'easyv.scheme.assessment','completed','scheme-assessment',?,?::jsonb,now(),now()+interval '180 days')
        """,id,viewer.userId(),viewer.scope().organizationId(),sessionId,id,json.write(evidence));
  }
  private static <T> T decode(String value,TypeReference<T> type) {
    if(value==null) return null;
    try { return JSON.readValue(value,type); }
    catch(JsonProcessingException failure) { throw new BackendException("DATABASE_JSON_INVALID","冻结方案评估输入 JSON 无效。",failure); }
  }
}
