package com.dip3.ontologyagent.config;

import org.junit.jupiter.api.Test;

import javax.xml.parsers.DocumentBuilderFactory;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AlibabaCompatibilityGateTest {
    @Test
    void buildRejectsAlibabaRuntimeUntilOneReleaseIsExplicitlyVerifiedAgainstTheGaBaseline() throws Exception {
        Path pom = Path.of("pom.xml");
        if (!Files.exists(pom)) pom = Path.of("backend-java", "pom.xml");
        var document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(pom.toFile());
        String xml = document.getDocumentElement().getTextContent();

        assertTrue(xml.contains("reject-incompatible-spring-ai-alibaba"));
        assertTrue(xml.contains("com.alibaba.cloud.ai:*"));
        assertFalse(xml.contains("spring-ai-alibaba-starter-dashscope"));
        assertFalse(xml.contains("spring-ai-alibaba-agent-framework"));
    }
}
