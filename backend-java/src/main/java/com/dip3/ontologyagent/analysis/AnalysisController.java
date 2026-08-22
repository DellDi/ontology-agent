package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.config.TraceFilter;
import com.dip3.ontologyagent.execution.ExecutionEvent;
import com.dip3.ontologyagent.followup.AnalysisFollowUpService;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
public final class AnalysisController {
    private final CookieSessionAuthenticator auth;
    private final AnalysisService analyses;
    private final JsonCodec json;
    private final BackendProperties properties;
    private final AnalysisFollowUpService followUps;

    public AnalysisController(CookieSessionAuthenticator auth, AnalysisService analyses,
                              JsonCodec json, BackendProperties properties) {
        this(auth, analyses, json, properties, null);
    }

    @Autowired
    public AnalysisController(CookieSessionAuthenticator auth, AnalysisService analyses,
                              JsonCodec json, BackendProperties properties, AnalysisFollowUpService followUps) {
        this.auth = auth;
        this.analyses = analyses;
        this.json = json;
        this.properties = properties;
        this.followUps = followUps;
    }

    @PostMapping(path = "/api/analysis/sessions",
            consumes = {MediaType.APPLICATION_FORM_URLENCODED_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<Void> create(@RequestParam(name = "question", defaultValue = "") String question,
                                       HttpServletRequest request) {
        AuthSession owner = auth.authenticate(request).orElse(null);
        if (owner == null) return redirect("/login?next=/workspace");
        try {
            AnalysisSession session = analyses.createSession(owner, question);
            return redirect("/workspace/analysis/" + session.id());
        } catch (BackendException error) {
            if (!List.of("INVALID_ANALYSIS_QUESTION", "UNSUPPORTED_ANALYSIS_SCOPE",
                    "ANALYSIS_CAPABILITY_UNSUPPORTED", "ACCESS_SCOPE_EMPTY")
                    .contains(error.code())) throw error;
            UriComponentsBuilder target = UriComponentsBuilder.fromPath("/workspace")
                    .queryParam("error", error.getMessage())
                    .queryParam("errorCode", error.code())
                    .queryParam("traceId", TraceFilter.from(request));
            if (!question.isBlank()) target.queryParam("draft", question.trim());
            return ResponseEntity.status(HttpStatus.SEE_OTHER).location(target.build().encode().toUri()).build();
        }
    }

    @PostMapping(path = "/api/analysis/sessions/{sessionId}/execute",
            consumes = {MediaType.APPLICATION_FORM_URLENCODED_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<Void> execute(@PathVariable String sessionId,
                                        @RequestParam(name = "followUpId", defaultValue = "") String followUpId,
                                        @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
                                        HttpServletRequest request) {
        AuthSession owner = auth.authenticate(request).orElse(null);
        if (owner == null) return redirect("/login?next=/workspace/analysis/" + sessionId);
        String executionId;
        if (followUpId.isBlank()) {
            executionId = analyses.submit(sessionId, owner, idempotencyKey, TraceFilter.from(request));
        } else {
            if (followUps == null) {
                throw new BackendException("FOLLOW_UP_EXECUTION_UNAVAILABLE", "追问执行组件未配置。");
            }
            try {
                executionId = followUps.submit(sessionId, followUpId, owner, idempotencyKey,
                        TraceFilter.from(request));
            } catch (BackendException error) {
                if (!List.of("FOLLOW_UP_REPLAN_REQUIRED", "FOLLOW_UP_NOT_FOUND",
                        "FOLLOW_UP_CONTEXT_INVALID", "FOLLOW_UP_EXECUTION_CONFLICT",
                        "FOLLOW_UP_ONTOLOGY_MISMATCH", "FOLLOW_UP_ALREADY_SUBMITTED")
                        .contains(error.code())) throw error;
                URI location = UriComponentsBuilder.fromPath("/workspace/analysis/{sessionId}")
                        .queryParam("followUpId", followUpId)
                        .queryParam("followUpExecutionError", error.getMessage())
                        .buildAndExpand(sessionId).encode().toUri();
                return ResponseEntity.status(HttpStatus.SEE_OTHER).location(location).build();
            }
        }
        UriComponentsBuilder locationBuilder = UriComponentsBuilder.fromPath("/workspace/analysis/{sessionId}")
                .queryParam("executionId", executionId);
        if (!followUpId.isBlank()) locationBuilder.queryParam("followUpId", followUpId);
        URI location = locationBuilder.buildAndExpand(sessionId).encode().toUri();
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(location).build();
    }

    @GetMapping(path = "/api/analysis/sessions/{sessionId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> stream(@PathVariable String sessionId,
                                                        @RequestParam String executionId,
                                                        @RequestParam(name = "afterSequence", required = false) String rawAfter,
                                                        HttpServletRequest request) {
        AuthSession owner = requireAuth(request);
        if (executionId.isBlank()) throw new BackendException("EXECUTION_ID_REQUIRED", "executionId 不能为空。");
        long afterSequence = parseAfterSequence(rawAfter);
        analyses.events(sessionId, executionId, owner, afterSequence);
        StreamingResponseBody body = output -> {
            long lastSequence = afterSequence;
            Instant deadline = Instant.now().plus(properties.stream().timeout());
            while (Instant.now().isBefore(deadline)) {
                List<ExecutionEvent> events = analyses.events(sessionId, executionId, owner, lastSequence);
                for (ExecutionEvent event : events) {
                    output.write(("data: " + json.write(event) + "\n\n").getBytes(StandardCharsets.UTF_8));
                    output.flush();
                    lastSequence = event.sequence();
                    if (event.terminal()) return;
                }
                try {
                    Thread.sleep(properties.stream().pollDelay());
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        };
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/event-stream; charset=utf-8"))
                .header(HttpHeaders.CACHE_CONTROL, "no-cache, no-transform")
                .header(HttpHeaders.CONNECTION, "keep-alive")
                .header("X-Accel-Buffering", "no").body(body);
    }

    @GetMapping("/internal/analysis/sessions/{sessionId}/executions/{executionId}/snapshot")
    public ResponseEntity<?> snapshot(@PathVariable String sessionId, @PathVariable String executionId,
                                      HttpServletRequest request) {
        AuthSession owner = requireAuth(request);
        return analyses.snapshot(sessionId, executionId, owner).<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private AuthSession requireAuth(HttpServletRequest request) {
        return auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    }

    private static long parseAfterSequence(String value) {
        if (value == null || value.isEmpty()) return 0;
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 0 || !Long.toString(parsed).equals(value)) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException error) {
            throw new BackendException("AFTER_SEQUENCE_INVALID", "afterSequence 必须是非负整数。");
        }
    }

    private static ResponseEntity<Void> redirect(String path) {
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create(path)).build();
    }
}
