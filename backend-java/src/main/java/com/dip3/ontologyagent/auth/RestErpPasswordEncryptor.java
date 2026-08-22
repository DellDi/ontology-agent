package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

@Component
public final class RestErpPasswordEncryptor implements ErpPasswordEncryptor {
    private static final Logger log = LoggerFactory.getLogger(RestErpPasswordEncryptor.class);

    private final RestClient restClient;
    private final String origin;

    public RestErpPasswordEncryptor(BackendProperties properties) {
        String baseUrl = properties.erpApiBaseUrl() == null ? "" : properties.erpApiBaseUrl();
        if (baseUrl.isBlank()) {
            // 未配置 ERP 目录接口：目录登录不可用，加密器保持禁用，不影响应用启动。
            this.restClient = null;
            this.origin = "";
            return;
        }
        this.restClient = RestClient.builder().baseUrl(baseUrl).build();
        this.origin = originOf(baseUrl, properties);
    }

    @Override
    public Optional<String> encrypt(String plainPassword) {
        if (restClient == null) {
            return Optional.empty();
        }
        try {
            Map<String, Object> payload = Map.of(
                    "content", plainPassword,
                    "isBatch", false,
                    "aesEnOrDeType", "encrypt");
            Map<?, ?> body = restClient.post()
                    .uri("/fastify/newsee/handlePassword")
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(HttpHeaders.ORIGIN, origin)
                    .body(payload)
                    .retrieve()
                    .body(Map.class);
            if (body == null || !Integer.valueOf(200).equals(body.get("statusCode"))
                    || !(body.get("result") instanceof String result) || result.isBlank()) {
                log.warn("erp_password_encrypt_invalid_response body={}", body);
                return Optional.empty();
            }
            return Optional.of(result);
        } catch (RestClientException | IllegalArgumentException error) {
            log.warn("erp_password_encrypt_failed message={}", error.getMessage());
            return Optional.empty();
        }
    }

    private static String originOf(String baseUrl, BackendProperties properties) {
        String configured = properties.erpApiOrigin();
        if (configured != null && !configured.isBlank()) {
            return configured;
        }
        URI base = URI.create(baseUrl);
        return base.getScheme() + "://" + base.getAuthority();
    }
}
