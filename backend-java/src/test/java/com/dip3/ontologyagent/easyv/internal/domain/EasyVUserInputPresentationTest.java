package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EasyVUserInputPresentationTest {
  @Test void keepsTheSelectedMetricAndTheUsersWordsWithoutBroadeningToTheBlock() {
    String input = "$_({\"id\":\"page-1__header1_3\",\"label\":\"测试数据指标\",\"componentId\":\"page-1__header1_3_chart_3\",\"componentLabel\":\"CPU平均利用率\"})删除";
    assertEquals(new EasyVUserInputPresentation.Presentation("【测试数据指标 / CPU平均利用率】删除", false),
        EasyVUserInputPresentation.present(input));
  }

  @Test void handlesQuotedDelimitersAndMultipleReferencesWithoutChangingPlainWords() {
    var json = new JsonCodec();
    String name = "CPU } ) \"利用率\"\\趋势";
    String input = "把$_(" + json.write(Map.of("id", "a", "label", name)) + ")和$_({\"id\":\"b\",\"label\":\"内存\"})换成折线图\n不要改标题";
    assertEquals(new EasyVUserInputPresentation.Presentation("把【" + name + "】和【内存】换成折线图\n不要改标题", false),
        EasyVUserInputPresentation.present(input));
    assertEquals(new EasyVUserInputPresentation.Presentation("删除主视觉", false), EasyVUserInputPresentation.present("删除主视觉"));
  }

  @Test void reportsUnrecognizableReferencesInsteadOfGuessingNamesOrLosingText() {
    for (String input : new String[]{"$_({\"id\":\"a\"})删除", "$_({\"label\":\"CPU\",\"componentId\":\"metric\"})删除",
        "$_({\"label\":\"CPU\",})删除", "$_({\"label\":\"CPU\"} {} )删除", "$_({\"label\":\"CPU\"})之后$_({未闭合",
        "$_(\"capability:expand_metric_pool\")新增"}) {
      assertEquals(new EasyVUserInputPresentation.Presentation(input, true), EasyVUserInputPresentation.present(input));
    }
  }
}
