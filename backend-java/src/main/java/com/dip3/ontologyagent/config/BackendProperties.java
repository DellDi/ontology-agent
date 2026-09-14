package com.dip3.ontologyagent.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("dip3")
public record BackendProperties(@NotBlank String sessionSecret, @NotBlank String redisKeyPrefix,
                                @Valid @NotNull Cube cube, @Valid @NotNull Neo4j neo4j,
                                @Valid @NotNull Worker worker, @Valid @NotNull Stream stream,
                                @Valid @NotNull Auth auth,
                                boolean cookieSecure) {
    public record Cube(@NotBlank String apiUrl, @NotBlank String apiSecret, @NotNull Duration timeout) {}
    public record Neo4j(@NotBlank String uri, @NotBlank String username, @NotBlank String password,
                        @NotBlank String database) {}
    public record Worker(boolean enabled, @NotNull Duration pollDelay) {}
    public record Stream(@NotNull Duration pollDelay, @NotNull Duration timeout) {}

    public record Auth(@Valid @NotNull Providers providers) {
        public record Providers(@Valid @NotNull Local local, @Valid @NotNull Bridge bridge) {
            /** 平台本地账号口令登录（identity.accounts）。 */
            public record Local(boolean enabled) {}

            /**
             * URL 桥接登录（可信上游平台跳转，如 EasyV 嵌入）。
             * 账号须由管理员预先供给；不自动注册未知账号。
             */
            public record Bridge(boolean enabled) {}
        }
    }
}
