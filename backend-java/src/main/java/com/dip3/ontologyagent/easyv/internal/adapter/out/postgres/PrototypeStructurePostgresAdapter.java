package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.easyv.internal.application.PrototypeStructureReadPort;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class PrototypeStructurePostgresAdapter implements PrototypeStructureReadPort {
  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  public PrototypeStructurePostgresAdapter(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
  }
  @Override
  public Map<String, Object> structure(String productVersionId, String appId) {
    return jdbc.queryForObject("""
        SELECT layout_structure FROM facts.easyv_prototype_layout
        WHERE product_version_id=? AND app_id=?
        """, (row, index) -> row.getString(1) == null ? null : json.map(row.getString(1)), productVersionId, appId);
  }
}
