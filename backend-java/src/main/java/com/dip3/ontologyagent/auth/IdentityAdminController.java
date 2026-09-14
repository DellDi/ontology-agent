package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 平台身份管理：账号供给、角色授予/撤销、启停用、重置密码。
 * 全部操作限 PLATFORM_ADMIN；变更落 platform.audit_events。
 */
@RestController
public final class IdentityAdminController {

    private final CookieSessionAuthenticator auth;
    private final IdentityAccountService accounts;

    public IdentityAdminController(CookieSessionAuthenticator auth, IdentityAccountService accounts) {
        this.auth = auth;
        this.accounts = accounts;
    }

    public record AccountView(long id, String account, String displayName, String status,
                              String source, String organizationId, List<String> roles) {}

    public record AccountList(List<AccountView> items) {}

    public record CreateAccountRequest(String account, String displayName, String password,
                                       String organizationId, List<String> roles) {}

    public record RoleChangeRequest(String roleCode, String action) {}

    public record UpdateAccountRequest(String status, String displayName, String organizationId,
                                       String password) {}

    @GetMapping("/api/admin/identity/accounts")
    public AccountList list(HttpServletRequest request) {
        requireAdmin(request);
        return new AccountList(accounts.list().stream().map(this::view).toList());
    }

    @PostMapping("/api/admin/identity/accounts")
    public AccountView create(HttpServletRequest request, @RequestBody CreateAccountRequest body) {
        AuthSession actor = requireAdmin(request);
        IdentityAccount created = accounts.provision(body.account(), body.displayName(),
                body.password(), body.organizationId(), "local", body.roles(), actor.userId());
        return view(created);
    }

    @PostMapping("/api/admin/identity/accounts/{id}/roles")
    public AccountView changeRole(HttpServletRequest request, @PathVariable long id,
                                  @RequestBody RoleChangeRequest body) {
        AuthSession actor = requireAdmin(request);
        if ("grant".equals(body.action())) {
            accounts.grantRole(id, body.roleCode(), actor.userId());
        } else if ("revoke".equals(body.action())) {
            accounts.revokeRole(id, body.roleCode());
        } else {
            throw new BackendException("IDENTITY_ROLE_ACTION_INVALID", "action 仅支持 grant/revoke。");
        }
        return view(requireAccount(id));
    }

    @PatchMapping("/api/admin/identity/accounts/{id}")
    public AccountView update(HttpServletRequest request, @PathVariable long id,
                              @RequestBody UpdateAccountRequest body) {
        requireAdmin(request);
        if (body.status() != null) {
            accounts.setStatus(id, body.status());
        }
        if (body.displayName() != null || body.organizationId() != null) {
            accounts.updateProfile(id, body.displayName(), body.organizationId());
        }
        if (body.password() != null) {
            accounts.resetPassword(id, body.password());
        }
        return view(requireAccount(id));
    }

    private AccountView view(IdentityAccount account) {
        return new AccountView(account.id(), account.account(), account.displayName(),
                account.status(), account.source(), account.organizationId(),
                accounts.roleCodes(account.id()));
    }

    private IdentityAccount requireAccount(long id) {
        return accounts.findById(id)
                .orElseThrow(() -> new BackendException("IDENTITY_ACCOUNT_NOT_FOUND", "账号不存在。"));
    }

    private AuthSession requireAdmin(HttpServletRequest request) {
        AuthSession actor = auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
        if (!actor.scope().roleCodes().contains(IdentityAccountService.PLATFORM_ADMIN)) {
            throw new BackendException("IDENTITY_ADMIN_FORBIDDEN", "无权管理平台账号。");
        }
        return actor;
    }
}
