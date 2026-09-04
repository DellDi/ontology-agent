# AGENTS.md

## Mission

面向真实业务团队的 production-oriented 产品：所有设计、实现、排障、文档与验证，服务商业化交付、产品化可用、专业工程质量、长期维护与持续演进，拒绝 demo 与玩具式实现。

## Priority

- 本文件是项目级主规范，优先于一般协作习惯；与 [`CLAUDE.md`](./CLAUDE.md) 冲突时以本文件为准（CLAUDE.md 仅作技术参考）。
- 面向 AI coding agent 优先，同时适用于人类工程师。
- 中文为主，保留必要英文关键词，避免误读执行意图。

## Product Standard

默认标准：`maintainable` / `testable` / `observable` / `auditable` / `diagnosable` / `evolvable`。

拒绝玩具式实现：只打通 happy path；用 mock、fallback、默认值掩盖真实集成问题；跳过权限、校验、契约换取“暂时可用”；把临时脚本、临时字段、临时逻辑伪装成正式方案。

## Root-Cause First

失败、报错、异常、数据不一致、链路中断时，默认先解决根因，而不是降级、兼容、绕过、静默跳过。

顺序：`Reproduce → Localize → Identify Root Cause → Fix → Add Guardrails`（补测试、日志、监控、校验或契约）。

强约束：不先加宽松兼容掩盖问题；不吞错、不返回默认值或伪成功；优先 `fail loud`，反对 `fail hidden`。

只有用户明确要求或有真实业务连续性压力时才允许临时缓解，且必须标注 `temporary mitigation`，写清：为什么不能直接修根因、影响范围、退出条件。

## Architecture Rules

- 保持 Clean Architecture / Ports and Adapters / Domain-first；新增能力沿 `domain → application → infrastructure → app` 扩展。
- 业务规则不堆进 UI、route handler、临时脚本或基础设施细节。
- 权限、数据契约、错误语义、任务执行边界属于正式设计，不是后补项。
- 上游输入、接口契约、依赖配置本身错误时修正源头，不在下游无限兜底。

## Execution Workflow

`understand -> inspect -> design -> implement -> verify -> document`

- 先读上下文再改动，不凭空假设。
- 影响产品行为、数据链路、权限、安全、部署路径的改动，先说明设计取舍再实施。
- 目标是提升真实产品可用性，不是“代码写完了”；临时补丁不得描述成最终方案。

## Quality Gates

交付前完成与影响范围匹配的验证：相关测试要跑、能构建的要构建、关键路径给出人类可理解的结论、无法验证的部分明确说明原因与风险。没有验证证据，不宣称“已完成”或“已修复”。

## Error Handling And Observability

- 不吞异常、不静默失败；错误信息保留足够上下文（来源、输入、状态、边界）。
- 新增关键链路优先保证可诊断性。
- 发现需求、契约或实现存在根本矛盾时，显式提出并推动修正，不静默绕过。

## Project Context

- 技术栈与命令详见 `CLAUDE.md`。
- 运行形态：Web 工作台（页面渲染 + Java BFF 透明代理 + 观测 + UI 映射）+ Java API/Worker 异步执行链路。
- 数据库所有权归 Java：PostgreSQL 由 Flyway `V1__init.sql`（幂等、可重复执行）独占初始化，经 `--spring.profiles.active=migrate` 独立入口执行，应用启动不自动迁移。
- 测试组织：Java 单元/集成（Testcontainers）+ `tests/*` 前端/契约验证。

## Local Development

基础设施容器化 + 应用代码宿主机运行：`postgres / redis / neo4j / cube` 用容器，`web` 用 `pnpm dev`，Java API/Worker 用 `mvn -f backend-java/pom.xml spring-boot:run`。仅当验证容器边界、镜像行为、compose 依赖顺序或部署问题时才全容器运行。

## Flyway Migrations

- schema 与迁移脚本必须同步，不允许存在未迁移的 schema 变更。
- 初始化脚本只放在 `backend-java/src/main/resources/db/migration/`，命名 `V<n>__<描述>.sql`。
- `V1__init.sql` 是幂等初始化脚本（全部 `IF NOT EXISTS`），可重复执行；schema 变更在其后新增 `V2+`。
- 宿主机执行：`mise exec java@temurin-21.0.12+8.0.LTS -- mvn -f backend-java/pom.xml -q spring-boot:run -Dspring-boot.run.profiles=migrate`；容器环境执行：`docker compose run --rm migrate`。空库建齐、已有库幂等补全。

## Definition Of Done

- 功能满足明确业务目标，而非仅局部可运行
- 关键失败路径可理解、可定位、可修复
- 改动符合架构边界，没有污染层次
- 验证完成，或已明确说明未验证部分与风险
- 没有把根因问题伪装成“兼容成功”或“降级完成”
