package com.dip3.ontologyagent.audit;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public final class AuditEventController {
    private final CookieSessionAuthenticator auth;
    private final AuditEventMapper events;

    public AuditEventController(CookieSessionAuthenticator auth, AuditEventMapper events) {
        this.auth = auth;
        this.events = events;
    }

    @GetMapping("/api/admin/audit/events")
    public AuditEventList recent(@RequestParam(defaultValue = "50") int limit, HttpServletRequest request) {
        AuthSession actor = auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("AUDIT_FORBIDDEN", "无权查看审计明细。");
        }
        if (limit < 1 || limit > 100) {
            throw new BackendException("AUDIT_LIMIT_INVALID", "审计查询 limit 必须在 1 到 100 之间。");
        }
        return new AuditEventList(events.recent(actor.scope().organizationId(), limit));
    }

    public record AuditEventList(List<AuditEvent> items) {}
}
