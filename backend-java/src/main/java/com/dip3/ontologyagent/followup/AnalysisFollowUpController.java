package com.dip3.ontologyagent.followup;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class AnalysisFollowUpController {
    private final CookieSessionAuthenticator auth;
    private final AnalysisFollowUpService followUps;
    private final JsonCodec json;

    public AnalysisFollowUpController(CookieSessionAuthenticator auth, AnalysisFollowUpService followUps,
                                      JsonCodec json) {
        this.auth = auth;
        this.followUps = followUps;
        this.json = json;
    }

    @GetMapping("/api/analysis/sessions/{sessionId}/follow-ups")
    public List<AnalysisFollowUp> list(@PathVariable String sessionId, HttpServletRequest request) {
        return followUps.list(sessionId, requireAuth(request));
    }

    @GetMapping("/api/analysis/sessions/{sessionId}/follow-ups/{followUpId}")
    public AnalysisFollowUp get(@PathVariable String sessionId, @PathVariable String followUpId,
                                HttpServletRequest request) {
        return followUps.get(sessionId, followUpId, requireAuth(request));
    }

    @PostMapping(path = "/api/analysis/sessions/{sessionId}/follow-ups",
            consumes = {MediaType.APPLICATION_FORM_URLENCODED_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<Void> create(@PathVariable String sessionId,
                                       @RequestParam(name = "question", defaultValue = "") String question,
                                       @RequestParam(name = "parentFollowUpId", defaultValue = "") String parentId,
                                       HttpServletRequest request) {
        AuthSession owner = auth.authenticate(request).orElse(null);
        if (owner == null) return redirect("/login?next=/workspace/analysis/" + sessionId);
        try {
            AnalysisFollowUp followUp = followUps.create(sessionId, owner, question, parentId);
            return sessionRedirect(sessionId, Map.of("followUpId", followUp.id()));
        } catch (BackendException error) {
            if (!List.of("INVALID_FOLLOW_UP_QUESTION", "FOLLOW_UP_SOURCE_NOT_FOUND",
                    "FOLLOW_UP_PARENT_NOT_COMPLETED", "FOLLOW_UP_CONTEXT_MISSING", "FOLLOW_UP_CONTEXT_INVALID",
                    "FOLLOW_UP_CONCLUSION_MISSING", "FOLLOW_UP_ONTOLOGY_MISSING", "FOLLOW_UP_NOT_FOUND",
                    "FOLLOW_UP_CAPABILITY_UNSUPPORTED", "FOLLOW_UP_SCOPE_INVALID",
                    "FOLLOW_UP_SCOPE_RESOLVER_UNAVAILABLE", "FOLLOW_UP_TIME_RANGE_INVALID",
                    "ONTOLOGY_PIN_RETIRED", "ONTOLOGY_PIN_NOT_PUBLISHED", "ONTOLOGY_PIN_NOT_FOUND")
                    .contains(error.code())) throw error;
            return sessionRedirect(sessionId, Map.of("followUpError", error.getMessage()));
        }
    }

    @PostMapping(path = "/api/analysis/sessions/{sessionId}/follow-ups/{followUpId}/context",
            consumes = {MediaType.APPLICATION_FORM_URLENCODED_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<Void> adjust(@PathVariable String sessionId, @PathVariable String followUpId,
                                       @RequestParam(name = "targetMetric", defaultValue = "") String targetMetric,
                                       @RequestParam(name = "entity", defaultValue = "") String entity,
                                       @RequestParam(name = "timeRange", defaultValue = "") String timeRange,
                                       @RequestParam(name = "comparison", defaultValue = "") String comparison,
                                       @RequestParam(name = "factor", defaultValue = "") String factor,
                                       @RequestParam(name = "confirmConflicts", defaultValue = "false") boolean confirm,
                                       HttpServletRequest request) {
        AuthSession owner = auth.authenticate(request).orElse(null);
        if (owner == null) return redirect("/login?next=/workspace/analysis/" + sessionId);
        Map<String, String> draft = Map.of("targetMetric", targetMetric, "entity", entity,
                "timeRange", timeRange, "comparison", comparison, "factor", factor);
        try {
            AnalysisFollowUpService.AdjustmentResult result = followUps.adjust(sessionId, followUpId, owner,
                    draft, confirm);
            return sessionRedirect(sessionId, Map.of("followUpId", result.followUp().id(),
                    "followUpContextUpdated", confirm ? "conflict-confirmed" : "true"));
        } catch (AnalysisFollowUpService.FollowUpConflictException error) {
            Map<String, String> params = draftParams(followUpId, draft);
            params.put("followUpConflict", json.write(error.conflicts()));
            return sessionRedirect(sessionId, params);
        } catch (BackendException error) {
            if (!List.of("INVALID_FOLLOW_UP_ADJUSTMENT", "FOLLOW_UP_STATE_CONFLICT",
                    "FOLLOW_UP_ALREADY_SUBMITTED").contains(error.code())) {
                throw error;
            }
            Map<String, String> params = draftParams(followUpId, draft);
            params.put("followUpAdjustmentError", error.getMessage());
            return sessionRedirect(sessionId, params);
        }
    }

    @PostMapping(path = "/api/analysis/sessions/{sessionId}/follow-ups/{followUpId}/replan",
            consumes = {MediaType.APPLICATION_FORM_URLENCODED_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<Void> replan(@PathVariable String sessionId, @PathVariable String followUpId,
                                       HttpServletRequest request) {
        AuthSession owner = auth.authenticate(request).orElse(null);
        if (owner == null) return redirect("/login?next=/workspace/analysis/" + sessionId);
        try {
            AnalysisFollowUp followUp = followUps.replan(sessionId, followUpId, owner);
            return sessionRedirect(sessionId, Map.of("followUpId", followUp.id(), "followUpReplanned", "true"));
        } catch (BackendException error) {
            if (!List.of("FOLLOW_UP_SOURCE_NOT_FOUND", "FOLLOW_UP_REPLAN_INVALID", "FOLLOW_UP_REPLAN_UNSUPPORTED",
                    "FOLLOW_UP_CONTEXT_MISSING", "FOLLOW_UP_CONTEXT_INVALID", "FOLLOW_UP_STATE_CONFLICT",
                    "FOLLOW_UP_ALREADY_SUBMITTED", "FOLLOW_UP_SCOPE_RESOLVER_UNAVAILABLE",
                    "ONTOLOGY_PIN_RETIRED", "ONTOLOGY_PIN_NOT_PUBLISHED", "ONTOLOGY_PIN_NOT_FOUND")
                    .contains(error.code())) throw error;
            return sessionRedirect(sessionId, Map.of("followUpId", followUpId,
                    "followUpReplanError", error.getMessage()));
        }
    }

    private AuthSession requireAuth(HttpServletRequest request) {
        return auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    }

    private static Map<String, String> draftParams(String followUpId, Map<String, String> draft) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("followUpId", followUpId);
        draft.forEach((key, value) -> {
            if (value != null && !value.isBlank()) params.put(key, value.trim());
        });
        return params;
    }

    private static ResponseEntity<Void> sessionRedirect(String sessionId, Map<String, String> params) {
        UriComponentsBuilder target = UriComponentsBuilder.fromPath("/workspace/analysis/{sessionId}");
        params.forEach(target::queryParam);
        URI location = target.buildAndExpand(sessionId).encode().toUri();
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(location).build();
    }

    private static ResponseEntity<Void> redirect(String path) {
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create(path)).build();
    }
}
