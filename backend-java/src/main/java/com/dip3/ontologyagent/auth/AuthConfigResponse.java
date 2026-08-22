package com.dip3.ontologyagent.auth;

/** 登录页能力状态（GET /api/auth/config）。 */
public record AuthConfigResponse(boolean directoryAuthAvailable, boolean devAuthEnabled,
                                 boolean urlBridgeEnabled) {}
