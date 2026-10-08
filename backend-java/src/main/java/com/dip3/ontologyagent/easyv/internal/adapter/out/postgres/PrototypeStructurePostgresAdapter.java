package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.easyv.internal.application.PrototypeStructureReadPort;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Collections;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeComponentGeometry;
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
  @Override
  public Map<String, Map<String, Object>> componentGeometry(String productVersionId, List<String> objectIds) {
    if (objectIds.isEmpty()) return Map.of();
    List<Object> args = new java.util.ArrayList<>();
    args.add(productVersionId); args.addAll(objectIds);
    Map<String, Map<String, Object>> result = new LinkedHashMap<>();
    jdbc.query("SELECT source_id::text || ':' || component_id AS object_id, geometry "
        + "FROM facts.easyv_prototype_component WHERE product_version_id=? AND "
        + "source_id::text || ':' || component_id IN (" + String.join(",", Collections.nCopies(objectIds.size(), "?")) + ")",
        row -> {
          String raw = row.getString("geometry");
          result.put(row.getString("object_id"), json.map(raw == null ? json.write(PrototypeComponentGeometry.parse(null)) : raw));
        }, args.toArray());
    return result;
  }
}
