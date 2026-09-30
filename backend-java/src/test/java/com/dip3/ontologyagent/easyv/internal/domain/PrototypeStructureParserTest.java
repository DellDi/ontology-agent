package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.Block;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.Parsed;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.Status;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PrototypeStructureParserTest {
  private static final String XML = """
      <Pages><Page height="1080" id="page-1" width="1920">
        <Theme><Header/></Theme>
        <Layout block-count="4" grid-direction="horizontal" type="凹形">
          <Sider gap="24" grid-direction="vertical" id="left" span="3/12">
            <Block blockSize="medium" block_type_id="1" id="page-1__left_1" span="4/12" weight="92"/>
            <Block blockSize="medium" block_type_id="1" id="page-1__left_2" span="4/12" weight="90"/>
          </Sider>
          <Layout grid-direction="vertical" span="6/12" gap="24">
            <Content id="main-content" span="8/12" ref="content-main"/>
            <Footer gap="24" id="foot" span="4/12" grid-direction="horizontal">
              <Block block_type_id="3" id="page-1__foot_1" span="12/12" weight="70"/>
            </Footer>
          </Layout>
          <Sider gap="24" grid-direction="vertical" id="right" span="3/12">
            <Block blockSize="medium" block_type_id="1" id="page-1__right_1" span="4/12" weight="70"/>
          </Sider>
        </Layout>
      </Page></Pages>
      """;

  private static Map<String, Object> component(String id, String family, int col, int row) {
    Map<String, Object> value = new LinkedHashMap<>();
    value.put("id", id);
    value.put("name", "不应被持久化的指标名称");
    value.put("desc", "不应被持久化的描述");
    value.put("chartFamily", family);
    value.put("componentId", "89084619192179" + id.length());
    value.put("sceneType", "趋势分析");
    value.put("sourceType", "AI");
    value.put("config", Map.of("gridPosition", Map.of("col", col, "row", row, "colSpan", 12, "rowSpan", 6)));
    return value;
  }

  private static Map<String, Object> block(String schemeId, Map<String, Object>... components) {
    Map<String, Object> value = new LinkedHashMap<>();
    value.put("schemeId", schemeId);
    value.put("title", "不应被持久化的标题");
    value.put("components", List.of(components));
    return value;
  }

  @SafeVarargs
  private static Map<String, Object> json(Map.Entry<String, Map<String, Object>>... blocks) {
    Map<String, Object> page = new LinkedHashMap<>();
    Map<String, Object> byId = new LinkedHashMap<>();
    for (var entry : blocks) byId.put(entry.getKey(), entry.getValue());
    page.put("title", "页面");
    page.put("blocks", byId);
    page.put("contents", List.of());
    return new LinkedHashMap<>(Map.of("page-1", page));
  }

  private static Map<String, Object> validJson() {
    return json(
        Map.entry("page-1__left_1", block("4", component("c1", "line", 1, 1),
            component("c22", "single-value-metric", 1, 7))),
        Map.entry("page-1__left_2", block("2", component("c3", "donut", 1, 1))),
        Map.entry("page-1__foot_1", block("42", component("c4", "horizontal-bar", 1, 1))),
        Map.entry("page-1__right_1", block("4", component("c5", "line", 1, 1))));
  }

  @Test
  void parsesBlocksComponentsAndContainerContext() {
    Parsed parsed = PrototypeStructureParser.parse(XML, validJson());

    assertEquals(Status.OK, parsed.status());
    assertNull(parsed.errorCode());
    assertEquals("凹形", parsed.layoutType());
    assertEquals(4, parsed.blocks().size());
    assertEquals(5, parsed.componentCount());

    Block left = parsed.blocks().get(0);
    assertEquals("page-1__left_1", left.blockId());
    assertEquals("Sider", left.containerTag());
    assertEquals("left", left.containerId());
    assertEquals("vertical", left.gridDirection());
    assertEquals("1", left.blockTypeId());
    assertEquals("medium", left.blockSize());
    assertEquals("4/12", left.span());
    assertEquals(92, left.weight());
    assertEquals("4", left.schemeId());
    assertEquals(2, left.components().size());
    assertEquals("line", left.components().get(0).chartFamily());
    assertEquals("趋势分析", left.components().get(0).sceneType());
    assertEquals(1, left.components().get(0).gridCol());
    assertEquals(12, left.components().get(0).gridColSpan());
  }

  @Test
  void keepsMissingBlockSizeAsNullInsteadOfInventingOne() {
    Block foot = PrototypeStructureParser.parse(XML, validJson()).blocks().stream()
        .filter(b -> b.blockId().equals("page-1__foot_1")).findFirst().orElseThrow();

    assertNull(foot.blockSize());
    assertEquals("Footer", foot.containerTag());
    assertEquals("horizontal", foot.gridDirection());
  }

  @Test
  void signaturesAreLayeredAndIgnoreFreeText() {
    Parsed base = PrototypeStructureParser.parse(XML, validJson());

    Map<String, Object> otherScheme = validJson();
    ((Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>) otherScheme.get("page-1"))
        .get("blocks")).get("page-1__left_2")).put("schemeId", "7");
    Parsed schemeChanged = PrototypeStructureParser.parse(XML, otherScheme);
    assertEquals(base.layoutSignature(), schemeChanged.layoutSignature());
    assertNotEquals(base.schemeSignature(), schemeChanged.schemeSignature());

    Map<String, Object> otherFamily = validJson();
    ((List<Map<String, Object>>) ((Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>)
        otherFamily.get("page-1")).get("blocks")).get("page-1__left_2")).get("components"))
        .get(0).put("chartFamily", "pie");
    Parsed familyChanged = PrototypeStructureParser.parse(XML, otherFamily);
    assertEquals(base.schemeSignature(), familyChanged.schemeSignature());
    assertEquals(base.countSignature(), familyChanged.countSignature());
    assertNotEquals(base.chartSignature(), familyChanged.chartSignature());

    Map<String, Object> renamed = validJson();
    ((Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>) renamed.get("page-1"))
        .get("blocks")).get("page-1__left_1")).put("title", "完全不同的标题");
    assertEquals(base.chartSignature(), PrototypeStructureParser.parse(XML, renamed).chartSignature());
  }

  @Test
  void identicalInputsGiveIdenticalSignatures() {
    assertEquals(PrototypeStructureParser.parse(XML, validJson()).chartSignature(),
        PrototypeStructureParser.parse(XML, validJson()).chartSignature());
    assertEquals(64, PrototypeStructureParser.parse(XML, validJson()).layoutSignature().length());
  }

  @Test
  void reportsMissingOrMalformedXmlWithLocatableCode() {
    assertEquals("XML_MISSING", PrototypeStructureParser.parse(null, validJson()).errorCode());
    assertEquals(Status.INVALID_XML, PrototypeStructureParser.parse(" ", validJson()).status());
    Parsed malformed = PrototypeStructureParser.parse("<Pages><Page>", validJson());
    assertEquals(Status.INVALID_XML, malformed.status());
    assertEquals("XML_MALFORMED", malformed.errorCode());
    assertTrue(malformed.blocks().isEmpty());
    assertNull(malformed.layoutSignature());
    assertEquals("XML_NO_LAYOUT",
        PrototypeStructureParser.parse("<Pages><Page/></Pages>", validJson()).errorCode());
  }

  @Test
  void rejectsDoctypeToAvoidExternalEntityExpansion() {
    Parsed parsed = PrototypeStructureParser.parse(
        "<!DOCTYPE Pages [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><Pages>&x;</Pages>", validJson());

    assertEquals(Status.INVALID_XML, parsed.status());
    assertEquals("XML_MALFORMED", parsed.errorCode());
  }

  @Test
  void reportsInvalidJson() {
    assertEquals("JSON_MISSING", PrototypeStructureParser.parse(XML, null).errorCode());
    assertEquals(Status.INVALID_JSON, PrototypeStructureParser.parse(XML, "not an object").status());
    assertEquals("JSON_NO_BLOCKS", PrototypeStructureParser.parse(XML, Map.of("files", List.of())).errorCode());
    Map<String, Object> noFamily = validJson();
    ((List<Map<String, Object>>) ((Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>)
        noFamily.get("page-1")).get("blocks")).get("page-1__left_2")).get("components"))
        .get(0).remove("chartFamily");
    Parsed parsed = PrototypeStructureParser.parse(XML, noFamily);
    assertEquals(Status.INVALID_JSON, parsed.status());
    assertEquals("COMPONENT_INVALID", parsed.errorCode());
    assertTrue(parsed.errorDetail().contains("page-1__left_2"));
  }

  @Test
  void reportsInconsistentBlockSetsWithBlockIdsButNoContent() {
    Map<String, Object> missing = json(
        Map.entry("page-1__left_1", block("4", component("c1", "line", 1, 1))),
        Map.entry("page-1__ghost_9", block("4", component("c2", "line", 1, 1))));
    Parsed parsed = PrototypeStructureParser.parse(XML, missing);

    assertEquals(Status.INCONSISTENT, parsed.status());
    assertEquals("BLOCK_SET_MISMATCH", parsed.errorCode());
    assertTrue(parsed.errorDetail().contains("page-1__ghost_9"));
    assertTrue(parsed.errorDetail().contains("page-1__left_2"));
    assertTrue(parsed.blocks().isEmpty());
  }

  @Test
  void allowsBlockWithoutComponents() {
    Map<String, Object> empty = json(
        Map.entry("page-1__left_1", block("4")), Map.entry("page-1__left_2", block("2")),
        Map.entry("page-1__foot_1", block("42")), Map.entry("page-1__right_1", block("4")));
    Parsed parsed = PrototypeStructureParser.parse(XML, empty);

    assertEquals(Status.OK, parsed.status());
    assertEquals(0, parsed.componentCount());
  }
}
