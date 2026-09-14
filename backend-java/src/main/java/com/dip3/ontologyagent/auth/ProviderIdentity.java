package com.dip3.ontologyagent.auth;

/**
 * Provider 认证通过后回传的外部身份。
 *
 * @param account        平台身份库中的账号键（登录名）
 * @param displayName    展示名
 * @param organizationId 组织归属（不透明字符串；未知时为空，由平台身份库兜底）
 */
public record ProviderIdentity(String account, String displayName, String organizationId) {}
