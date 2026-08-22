package com.dip3.ontologyagent.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

@Component
public final class TraceFilter extends OncePerRequestFilter {
    public static final String HEADER = "x-correlation-id";
    public static final String ATTRIBUTE = TraceFilter.class.getName() + ".traceId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String inbound = request.getHeader(HEADER);
        String traceId = inbound != null && inbound.matches("[A-Za-z0-9._:-]{1,128}")
                ? inbound : UUID.randomUUID().toString();
        request.setAttribute(ATTRIBUTE, traceId);
        response.setHeader(HEADER, traceId);
        chain.doFilter(request, response);
    }

    public static String from(HttpServletRequest request) {
        Object value = request.getAttribute(ATTRIBUTE);
        return value == null ? UUID.randomUUID().toString() : value.toString();
    }
}
