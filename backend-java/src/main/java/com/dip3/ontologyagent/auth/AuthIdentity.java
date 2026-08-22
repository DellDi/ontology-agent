package com.dip3.ontologyagent.auth;

/** 登录后的身份与权限范围（未落库，落库形态为 AuthSession）。 */
public record AuthIdentity(String userId, String displayName, AccessScope scope) {}
