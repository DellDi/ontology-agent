package com.dip3.ontologyagent.audit;

import com.dip3.ontologyagent.support.JsonbTypeHandler;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.Instant;
import java.util.List;

@Mapper
public interface AuditEventMapper {
    @Select("""
            select id,user_id,organization_id,session_id,event_type,event_result,event_source,
                   correlation_id,payload,created_at,retention_until
            from platform.audit_events
            where organization_id=#{organizationId}
            order by created_at desc,id desc limit #{limit}
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "user_id", javaType = String.class),
            @Arg(column = "organization_id", javaType = String.class),
            @Arg(column = "session_id", javaType = String.class),
            @Arg(column = "event_type", javaType = String.class),
            @Arg(column = "event_result", javaType = String.class),
            @Arg(column = "event_source", javaType = String.class),
            @Arg(column = "correlation_id", javaType = String.class),
            @Arg(column = "payload", javaType = Object.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "created_at", javaType = Instant.class),
            @Arg(column = "retention_until", javaType = Instant.class)
    })
    List<AuditEvent> recent(@Param("organizationId") String organizationId, @Param("limit") int limit);
}
