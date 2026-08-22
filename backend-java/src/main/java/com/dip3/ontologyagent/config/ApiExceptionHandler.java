package com.dip3.ontologyagent.config;

import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public final class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    public ApiExceptionHandler() {}

    @ExceptionHandler(BackendException.class)
    ResponseEntity<Map<String, String>> known(BackendException error, HttpServletRequest request) {
        String traceId = TraceFilter.from(request);
        HttpStatus status = status(error.code());
        if (status.is5xxServerError()) {
            log.warn("request_failed code={} traceId={} path={} message={}", error.code(), traceId,
                    request.getRequestURI(), error.getMessage(), error);
        } else {
            log.warn("request_rejected code={} traceId={} path={} message={}", error.code(), traceId,
                    request.getRequestURI(), error.getMessage());
        }
        return ResponseEntity.status(status).body(Map.of("error", error.getMessage(), "code", error.code(),
                "traceId", traceId));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, String>> unexpected(Exception error, HttpServletRequest request) {
        String traceId = TraceFilter.from(request);
        log.error("request_failed code=INTERNAL_ERROR traceId={} path={}", traceId, request.getRequestURI(), error);
        return ResponseEntity.internalServerError().body(Map.of("error", "服务内部错误。", "code", "INTERNAL_ERROR",
                "traceId", traceId));
    }

    private static HttpStatus status(String code) {
        if ("AUTH_REQUIRED".equals(code)) return HttpStatus.UNAUTHORIZED;
        if (code.endsWith("_FORBIDDEN")) return HttpStatus.FORBIDDEN;
        if (code.endsWith("_NOT_FOUND") || "SESSION_NOT_FOUND".equals(code)) return HttpStatus.NOT_FOUND;
        if (code.contains("INVALID") || code.endsWith("_REQUIRED") || "FOLLOW_UP_NOT_MIGRATED".equals(code)
                || "UNSUPPORTED_ANALYSIS_SCOPE".equals(code)) {
            return HttpStatus.BAD_REQUEST;
        }
        if (code.endsWith("_CONFLICT") || code.contains("MISMATCH") || code.contains("VIOLATION")
                || "LEGACY_EXECUTION_NOT_MIGRATED".equals(code)) {
            return HttpStatus.CONFLICT;
        }
        if (code.contains("PROVIDER") || code.startsWith("CUBE_") || code.startsWith("NEO4J_")
                || code.startsWith("REDIS_") || code.startsWith("LLM_") || code.startsWith("AGENT_")) {
            return HttpStatus.BAD_GATEWAY;
        }
        return HttpStatus.UNPROCESSABLE_CONTENT;
    }
}
