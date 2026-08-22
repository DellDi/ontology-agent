# Java 后端二阶段目标：多轮追问与重规划闭环

## Goal

在一期 Java 首次分析完成态之上，交付一个可审计、可恢复的多轮追问纵向切片：用户可以承接根轮次或上一追问轮次的已完成结论，纠正本轮上下文并生成可比较的新计划，随后由 Main Agent **且仅调用一次** Follow-up Workflow Tool 完成真实执行；每轮 Job、事件、Snapshot、证据、结论和本体版本独立持久化，页面可以流式跟踪并回看历史，刷新不会重跑。

## 范围

- Java API：创建追问、修改可执行上下文、重规划、提交执行、按轮次读取与 SSE 恢复。
- 继承边界：只承接已持久化的 completed Snapshot；继承其 `_resolvedContext`、结论与 pinned ontology version。缺失事实时 fail loud，不从问题文本或旧占位字段猜测。
- 执行边界：新增 `java-follow-up-v1` Job contract，与 `java-initial-v1` 和遗留 TypeScript Job 显式隔离；沿用租约、heartbeat、Agent invocation exactly-once 和终态原子事务。
- Agent 协作：复用 Spring AI `ChatClient`、`MessageChatMemoryAdvisor`、JDBC ChatMemory 与 `@Tool(returnDirect = true)`；Memory 只提供模型消息上下文，PostgreSQL follow-up/plan/snapshot 仍是业务真相。
- Workflow：复用一期受治理的 ERP、Cube、Neo4j 和结论链路；本阶段仍只支持当前已发布的项目收缴率 capability，不以兼容代码伪装支持其他指标。
- Next.js：Route 只做代理；Java 聚合契约提供追问与历史轮次；复用现有 Conversation/Follow-up/History 组件，不建立第二套聊天协议。

## 不在本阶段

- Alibaba Agent Framework Adapter、移动端完整迁移、Ontology 治理写后台、旧 TypeScript 历史数据迁移。
- 通用任意指标/任意时间粒度；当前 capability 之外的请求明确拒绝。
- fallback 模型、规则回答、吞错、内存态业务真相或失败后静默重跑。

## 验收

1. 根结论可创建追问；父追问链按 `created_order` 稳定排序，跨 owner/session/scope 被拒绝。
2. 上下文纠正发生冲突时要求显式确认；变更会使当前计划失效；重规划保留前后版本和 diff。
3. 同一 follow-up 的并发/重复提交只绑定一个 execution；Job payload、Snapshot 和 follow-up 的 ID/ontology version 一致。
4. Main Agent 每轮恰好一次 Follow-up Workflow Tool；三类真实证据非空且结论保留行级 provenance 后才 completed。
5. Root/follow-up/遗留 TypeScript Job 不互相领取；租约丢失、重试和事务回滚不产生第二次 Tool 调用或伪终态。
6. 页面可创建、执行、流式查看并切换历史轮次；刷新从 Snapshot/Event 恢复，不自动重跑历史。
7. Java 单元测试、PostgreSQL Testcontainers、JSON Schema + Zod 契约、Next 定向测试、lint/typecheck/build 全部通过。
