# 测试边界

当前后端质量门以 Java 与 Web/Java 跨端契约为准：

```bash
pnpm test
pnpm test:container
pnpm test:live:analysis
```

- `pnpm test` 执行 Java 单元/集成测试，以及当前 Next 透明代理、JSON Schema、Zod、移动端投影和 Java cutover 边界测试。
- `pnpm test:container` 使用生产 Compose 验证 Web、Java backend、migration、PostgreSQL、Redis、Cube/Cube Store 与 Neo4j。
- `pnpm test:live:analysis` 需要真实 Provider、Cube 与 Neo4j 数据，验证 Main Agent → Workflow Tool → Structured Conclusion。

仓库中其余 `story-*.test.*` 是前序产品故事的局部回归，不是可整体执行的旧 TypeScript 后端验收集。与已删除 Node Agent/Worker/LLM/Tooling 实现直接绑定的测试已经移除；新增后端行为必须进入 Java 测试或 `test:web`，不得重新建立 TypeScript 业务旁路。
