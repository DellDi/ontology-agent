package com.dip3.ontologyagent.integration.redis;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
public final class RedisWakeupAdapter implements WakeupPublisher {
    private final StringRedisTemplate redis;
    private final String channel;

    public RedisWakeupAdapter(StringRedisTemplate redis, BackendProperties properties) {
        this.redis = redis;
        this.channel = properties.redisKeyPrefix() + ":job:wakeup";
    }

    @Override
    public void publish(String executionId) {
        redis.convertAndSend(channel, executionId);
    }
}
