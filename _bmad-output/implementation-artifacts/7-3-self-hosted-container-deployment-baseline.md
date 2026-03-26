# Story 7.3: 建立自托管容器化部署基线

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 企业运维负责人,
I want 使用标准化容器方式部署平台核心能力,
so that 我们可以在自有环境中运行系统而不依赖公有云专属托管能力。

## Acceptance Criteria

1. 运维团队按交付说明部署时，核心服务必须能够以容器方式启动。
2. 核心功能运行不能依赖公有云专属托管平台。
3. 部署基线必须清晰表达 Web、Worker 和基础设施依赖的组件边界，并为后续向 Kubernetes 演进保留清晰边界。

## Tasks / Subtasks

- [ ] 在现有 Compose 基线之上补齐交付型部署边界（AC: 1, 2, 3）
  - [ ] 明确区分开发容器与生产 / 试点部署镜像。
  - [ ] 为 web、worker、postgres、redis 表达清晰边界。
- [ ] 收敛配置与运行说明（AC: 1, 2）
  - [ ] 区分宿主机地址与容器内部地址。
  - [ ] 去掉仅适合 `next dev` 的交付假设。
- [ ] 覆盖部署基线验证（AC: 1, 2, 3）
  - [ ] 运行 `docker compose config` 与容器启动冒烟验证。
  - [ ] 校验健康检查与依赖顺序。

## Dev Notes

- 这不是重做 Story 2.1，而是在开发基线之上补“可交付部署边界”。
- 不应把开发便利配置、宽松 secrets 或 stub 登录默认值直接带入部署基线。
- 当前仓库尚无完整 CI/CD；本故事聚焦“可部署基线清晰”，不假装已有成熟发布流水线。

### Architecture Compliance

- 继续沿用模块化单体 + 独立 worker 进程边界。
- 自托管要求核心能力不依赖公有云专属服务。
- 配置边界要清晰，避免 host / container 地址混用再次引发故障。

### File Structure Requirements

- 重点文件预计包括：
  - `compose.yaml`
  - 生产镜像文件，如 `Dockerfile` 或等价构建工件
  - `.env.example`
  - `docs/local-infrastructure.md` 或新增部署文档
  - 部署契约测试

### Testing Requirements

- 至少覆盖：
  - `docker compose config`
  - `web` / `worker` / `postgres` / `redis` 能启动
  - 健康检查通过
  - 如新增生产镜像，构建冒烟成功

### Previous Story Intelligence

- Story 2.1 已建立本地 Compose 基线，但仍偏开发环境。
- Story 2.6 的 worker skeleton 会成为这里容器边界的一部分。
- Story 7.4 的观测组件最好在这套容器基线上继续接入。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3: 建立自托管容器化部署基线]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/7-3-self-hosted-container-deployment-baseline.md
