# AGENTS.md

## Mission

本项目是一个面向真实业务团队的 `production-oriented environment product`，不是 demo、玩具、样例仓库，也不是只追求“能跑起来”的实验代码。

所有设计、实现、排障、文档与验证，都必须优先服务以下目标：

- 商业化交付
- 产品化可用
- 专业工程质量
- 长期维护与持续演进

## Priority

- 本文件是项目级主规范，优先于一般协作习惯。
- 本文件面向 AI coding agent 优先，同时适用于人类工程师。
- 如与 [`CLAUDE.md`](./CLAUDE.md) 存在冲突，以本文件为准；`CLAUDE.md` 视为补充背景与兼容说明。
- 语言策略为中文为主，保留必要的英文关键词，避免 agent 误读执行意图。

## Product Standard

任何产出都必须朝“真实可交付产品”推进，而不是只完成局部功能。

默认标准：

- `maintainable`：结构清晰，责任边界明确，可长期维护
- `testable`：关键行为可验证，不能只靠人工猜测
- `observable`：关键链路出问题时可定位，不做黑箱实现
- `auditable`：关键决策、权限、数据流可追踪
- `diagnosable`：失败时能看到真实原因，而不是被掩盖
- `evolvable`：支持后续扩展，而不是一次性脚本式实现

默认拒绝玩具式实现：

- 只打通 happy path，不处理失败路径
- 用 mock、fallback、默认值掩盖真实集成问题
- 通过跳过权限、校验、契约来换取“暂时可用”
- 把临时脚本、临时字段、临时逻辑伪装成正式方案

## Root-Cause First Policy

遇到失败、报错、异常、数据不一致、链路中断时，默认策略不是降级、兼容、绕过、静默跳过，而是先解决根因。

默认处理顺序：

1. `Reproduce`：稳定复现问题
2. `Localize`：收缩问题边界
3. `Identify Root Cause`：找到根因
4. `Fix the Root Cause`：修复根因
5. `Add Guardrails`：补测试、日志、监控、校验或契约，防止复发

强约束：

- 不要先加宽松兼容来掩盖问题
- 不要先吞错、返回默认值或伪成功
- 不要把“先绕过去”当成默认正确方向
- 优先 `fail loud`，反对 `fail hidden`

只有在用户明确要求，或存在真实业务连续性压力时，才允许临时缓解措施。此时必须明确标注为 `temporary mitigation`，并写清：

- 为什么暂时不能直接修根因
- 影响范围是什么
- 退出条件是什么

## Architecture Rules

- 继续遵守当前仓库的 `Clean Architecture / Ports and Adapters / Domain-first` 方向。
- 新增能力优先沿 `domain -> application -> infrastructure -> app` 扩展。
- 业务规则不能直接堆进 UI、route handler、临时脚本或基础设施细节里。
- 权限、数据契约、错误语义、任务执行边界，属于正式设计的一部分，不是后补项。
- 如果上游输入、接口契约、依赖配置本身错误，应优先修正源头，而不是在下游无限兜底。

## Execution Workflow

默认工作流：

`understand -> inspect -> design -> implement -> verify -> document`

执行要求：

- 先读上下文，再改动，不凭空假设
- 影响产品行为、数据链路、权限、安全、部署路径的改动，先说明设计取舍再实施
- 改动目标应是提升真实产品可用性，而不是只满足“代码写完了”
- 不要把临时补丁描述成最终方案

## Quality Gates

除非用户明确要求跳过，否则交付前至少完成与影响范围匹配的验证：

- 相关测试要跑
- 能构建的要构建
- 关键路径要给出人类可理解的验证结论
- 无法验证的部分必须明确说明原因、缺口与风险

没有验证证据，不要宣称“已经完成”或“已经修复”。

## Error Handling And Observability

- 不要吞掉异常，不要静默失败
- 错误信息应保留足够上下文，便于定位来源、输入、状态与边界条件
- 新增关键链路时，优先保证可诊断性，而不是只保证界面不报错
- 如果发现需求、契约或现有实现存在根本矛盾，应显式提出并推动修正，不要静默绕过

## Project Context

当前项目上下文默认如下：

- 技术栈：`Next.js 16`、`React 19`、`TypeScript 5`、`Drizzle ORM`、`PostgreSQL`、`Redis`
- 运行形态：Web 工作台 + Worker 异步执行链路
- 架构方向：Clean Architecture、ports/adapters、领域与基础设施解耦
- 测试组织：`tests/story-*.test.*` 为主的 story-based 验证
- 交互与错误语义：中文优先，面向真实业务用户理解

## Local Development Recommendation

本地开发默认推荐采用 `基础设施容器化 + 应用代码宿主机运行` 的混合模式，而不是把所有服务都做成开发期全容器运行。

推荐组合：

- `postgres / redis / neo4j / cube` 使用容器运行
- `web` 在宿主机使用 `pnpm dev`
- `worker` 在宿主机使用 `pnpm worker:dev`

这样更适合作为日常开发默认形态

只有在需要验证更贴近生产的容器边界、镜像行为、compose 依赖顺序或部署问题时，才应显式启用开发期全容器运行。

## Definition Of Done

一项工作只有在以下条件基本成立时，才算真正完成：

- 功能满足明确业务目标，而不是仅局部可运行
- 关键失败路径可理解、可定位、可修复
- 改动符合当前架构边界，没有明显污染层次
- 验证已经完成，或已明确说明未验证部分及风险
- 没有把根因问题伪装成“兼容成功”或“降级完成”
