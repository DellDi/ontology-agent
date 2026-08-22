package com.dip3.ontologyagent.integration.redis;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.execution.WorkerScheduler;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.VirtualThreadTaskExecutor;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "dip3.worker", name = "enabled", havingValue = "true")
public class RedisWorkerWakeupConfiguration {
    @Bean
    RedisMessageListenerContainer workerWakeupContainer(RedisConnectionFactory connectionFactory,
                                                          BackendProperties properties,
                                                          WorkerScheduler worker,
                                                          @Qualifier("analysisWakeExecutor") TaskExecutor analysisWakeExecutor) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.setTaskExecutor(analysisWakeExecutor);
        container.addMessageListener((message, pattern) -> worker.wake(),
                new ChannelTopic(properties.redisKeyPrefix() + ":job:wakeup"));
        return container;
    }

    @Bean
    TaskExecutor analysisWakeExecutor() {
        return new VirtualThreadTaskExecutor("analysis-redis-wakeup-");
    }
}
