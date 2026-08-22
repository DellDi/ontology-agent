package com.dip3.ontologyagent.config;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Locale;

@Component
public final class ProviderCompatibilityValidator {
    private final ProviderCapabilityProperties properties;
    private final String baseUrl;
    private final String model;

    public ProviderCompatibilityValidator(ProviderCapabilityProperties properties, Environment environment) {
        this.properties = properties;
        this.baseUrl = first(environment, "endpoint", "spring.ai.openai.chat.base-url",
                "spring.ai.openai.base-url");
        first(environment, "API key", "spring.ai.openai.chat.api-key", "spring.ai.openai.api-key");
        this.model = first(environment, "model", "spring.ai.openai.chat.model");
        validateEndpoint();
        if (!properties.toolCalling()) {
            throw new IllegalStateException("LLM Provider 必须显式声明 tool-calling 能力，系统不会降级为自由文本执行。");
        }
        if (environment.getProperty("spring.ai.openai.chat.max-retries", Integer.class, 3) != 0) {
            throw new IllegalStateException("spring.ai.openai.chat.max-retries 必须为 0，Provider 失败不得自动重试或 fallback。");
        }
        if (environment.getProperty("spring.ai.openai.chat.parallel-tool-calls", Boolean.class, true)) {
            throw new IllegalStateException("spring.ai.openai.chat.parallel-tool-calls 必须为 false，工作流只允许单次串行 tool call。");
        }
    }

    public ProviderCapabilityProperties properties() {
        return properties;
    }

    public String baseUrl() {
        return baseUrl;
    }

    public String model() {
        return model;
    }

    private void validateEndpoint() {
        URI endpoint;
        try {
            endpoint = URI.create(baseUrl);
        } catch (IllegalArgumentException error) {
            throw new IllegalStateException("spring.ai.openai.base-url 不是合法 URI。", error);
        }
        String host = endpoint.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalStateException("spring.ai.openai.base-url 必须包含主机名。");
        }
        boolean loopback = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1");
        if (!"https".equalsIgnoreCase(endpoint.getScheme()) && !(loopback && "http".equalsIgnoreCase(endpoint.getScheme()))) {
            throw new IllegalStateException("LLM Provider 必须使用 HTTPS；仅本机 loopback 测试端点允许 HTTP。");
        }
        boolean alibabaEndpoint = host.toLowerCase(Locale.ROOT).endsWith("aliyuncs.com");
        if (properties.mode() == ProviderCapabilityProperties.Mode.DASHSCOPE) {
            if (!alibabaEndpoint || endpoint.getPath() == null
                    || !endpoint.getPath().replaceAll("/+$", "").endsWith("/compatible-mode/v1")) {
                throw new IllegalStateException("dashscope 模式必须使用阿里云百炼 OpenAI compatible-mode/v1 HTTPS 端点。");
            }
            if (properties.structuredOutput() != ProviderCapabilityProperties.StructuredOutput.JSON_OBJECT) {
                throw new IllegalStateException("dashscope 模式仅发布已验证的 JSON_OBJECT 结构化输出能力，不能声明 native JSON Schema。");
            }
        } else if (alibabaEndpoint) {
            throw new IllegalStateException("阿里云百炼端点必须显式使用 dashscope 模式，禁止伪装成通用 OpenAI-compatible Provider。");
        }
    }

    private static String first(Environment environment, String label, String... keys) {
        for (String key : keys) {
            String value = environment.getProperty(key);
            if (value != null && !value.isBlank()) return value.trim();
        }
        throw new IllegalStateException("缺少必需的 LLM Provider " + label + " 配置。");
    }
}
