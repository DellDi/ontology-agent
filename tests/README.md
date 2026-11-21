# 测试边界

当前后端质量门以 Java 与 Web/Java 跨端契约为准：

```bash
pnpm test:web
pnpm test:auth-hardening
mvn -f backend-java/pom.xml test
pnpm test:container
mvn -f backend-java/pom.xml verify -Plive-integration
```

- `pnpm test:web` 执行当前 Next 透明代理（含认证路由与 Set-Cookie 透传）、JSON Schema、Zod、移动端投影、Java cutover 边界与有效前端回归测试。
- `pnpm test:auth-hardening` 启动 Next 开发服务并通过桩 Java 后端验证登录页禁手填 scope、拒伪造登录与 `/api/auth/callback` 404。
- `mvn -f backend-java/pom.xml test` 执行 Java 单元/集成测试（含认证、Flyway 迁移策略与 Testcontainers）。
- `pnpm test:container` 使用生产 Compose 验证 Web、Java backend、Flyway migration、PostgreSQL、Redis、Cube/Cube Store 与 Neo4j。
- `mvn -f backend-java/pom.xml verify -Plive-integration` 需要真实 Provider、Cube 与 Neo4j 数据，验证 Main Agent → Workflow Tool → Structured Conclusion。

仓库中其余 `story-*.test.*` 是仍有效的前端行为/领域模型局部回归。与已删除 Node 实现
（Agent/Worker/LLM/Tooling、Drizzle、Redis/Cube/Neo4j/Graph Sync/Ontology 的 TypeScript 存储、
Node 认证与 Session 存储）直接绑定的测试已经移除；新增后端行为必须进入 Java 测试或 `test:web`，
不得重新建立 TypeScript 业务旁路。
