package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.easyv.internal.domain.SchemeLibraryParser;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/** 一个冻结方案产品同时绑定方案与槽位类型源，不在读取时连接最新源库。 */
public final class EasyVSchemeCanonicalTransform implements CanonicalProductTransform {
  public static final String PRODUCT_KEY = "easyv-scheme-library";
  public static final String TRANSFORM_REF = "easyv-scheme-library-v1";
  private final JdbcTemplate jdbc;
  private final JsonCodec json;

  public EasyVSchemeCanonicalTransform(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
  }
  @Override public String transformRef() { return TRANSFORM_REF; }

  @Override public PreparedProduct prepare(Context context) {
    var product = context.product();
    if (!PRODUCT_KEY.equals(product.productKey()) || !"easyv".equals(product.domainKey())
        || !"facts".equals(product.canonicalSchema()) || !"easyv_scheme_library".equals(product.canonicalRelation())
        || !TRANSFORM_REF.equals(product.transformRef())
        || !context.inputs().keySet().equals(Set.of("source", "slot-types"))) {
      throw new IllegalArgumentException("EasyV scheme transform does not match product registration");
    }
    SourceInput source = context.inputs().get("source");
    SourceInput types = context.inputs().get("slot-types");
    if (!"easyv-block-scheme".equals(source.dataset().datasetKey())
        || !"easyv-slot-type".equals(types.dataset().datasetKey())) {
      throw new IllegalArgumentException("EasyV scheme inputs do not match dataset contracts");
    }
    var typeColumns = new EasyVCanonicalTransform.Columns(types);
    Map<String, SchemeLibraryParser.Constraint> constraints = new LinkedHashMap<>();
    for (var row : types.rows()) {
      String id = Long.toString(typeColumns.longValue(row, "id"));
      if (constraints.putIfAbsent(id, SchemeLibraryParser.constraint(
          typeColumns.value(row, "allowed_chart_categories"), typeColumns.value(row, "recommend_type"))) != null) {
        throw new IllegalArgumentException("Duplicate EasyV slot type: " + id);
      }
    }
    var columns = new EasyVCanonicalTransform.Columns(source);
    List<List<Object>> rows = new ArrayList<>();
    for (var row : source.rows()) {
      long id = columns.longValue(row, "id");
      int count = columns.integer(row, "chat_count");
      var parsed = SchemeLibraryParser.parse(count, columns.value(row, "block_slots_data"), constraints);
      rows.add(Collections.unmodifiableList(Arrays.asList(context.productVersionId(), source.dataset().datasetKey(),
          source.sourceVersionId(), id, columns.text(row, "block_type_id"), count,
          columns.nullableText(row, "pattern_tag"), parsed.status(), parsed.errorCode(),
          parsed.slots() == null ? null : json.write(parsed.slots()))));
    }
    rows.sort(Comparator.comparingLong(row -> (Long) row.get(3)));
    return new PreparedProduct("facts://easyv_scheme_library/" + context.productVersionId(), rows.size(),
        EasyVCanonicalTransform.contentHash(rows), () -> rows.forEach(row -> jdbc.update("""
          insert into facts.easyv_scheme_library
            (product_version_id,source_dataset_key,source_dataset_version_id,source_id,block_type_id,
             chart_count,pattern_tag,parse_status,parse_error_code,slots)
          values (?,?,?,?,?,?,?,?,?,?::jsonb)
          """, row.toArray())));
  }
}
