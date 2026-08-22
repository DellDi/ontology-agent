FROM maven:3.9.11-eclipse-temurin-21 AS builder

WORKDIR /workspace

COPY backend-java/pom.xml backend-java/pom.xml
RUN mvn -B -ntp -f backend-java/pom.xml dependency:go-offline

COPY backend-java/src backend-java/src
RUN mvn -B -ntp -f backend-java/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre

ENV TZ=Asia/Taipei
ENV JAVA_TOOL_OPTIONS=-Duser.timezone=Asia/Taipei

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN groupadd --system --gid 1001 spring \
    && useradd --system --uid 1001 --gid spring --create-home spring

COPY --from=builder --chown=spring:spring /workspace/backend-java/target/ontology-agent-backend-*.jar /app/application.jar

USER spring

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/application.jar"]
