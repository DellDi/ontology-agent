# Story 7.5: 账号密码登录与 URL 账号免密桥接

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 内部试点用户,
I want 使用已同步 ERP 用户账号和密码登录，并在 URL 携带账号时直接进入受保护工作台,
so that 我可以复用物业 ERP 已同步过来的用户目录完成登录与权限投影，而不需要再建设一套新的组织、用户、角色权限系统。

## Acceptance Criteria

1. 登录页必须支持“账号 + 密码”的登录方式，系统先按 `dw_datacenter_system_user.user_account` 唯一定位用户，再调用远端加密接口对输入密码执行加密，并与 `dw_datacenter_system_user.user_password` 做相等比较；不再要求用户手动输入组织、项目、区域或角色信息。
2. 当 URL 中包含 `account` 参数，且内部桥接入口已启用时，系统可以直接按账号解析唯一有效用户、创建服务端会话并跳转到受保护页面，不要求再次输入密码。
3. 当账号不存在、命中多条、用户停用、远端加密接口失败，或加密结果与 `user_password` 不一致时，系统必须返回稳定错误、不创建会话，并且不泄露额外敏感信息。
4. 登录成功后的 scope 必须沿用当前业务链路：`user -> org -> 下级项目组织(propertyProject) -> projectId / ownerId -> 业务事实`；`ChargeItem` 不做权限控制，`areaId` 不再作为权限链的一部分；平台只保留最小服务端会话，不新增本地组织/用户/RBAC 权威。

## Tasks / Subtasks

- [ ] 建立目录登录与 URL 桥接的认证契约（AC: 1, 2, 3, 4）
  - [ ] 在 `application` 层定义“按账号查用户”“远端加密验密”“构建会话 scope”“URL 账号免密桥接”的端口与用例。
  - [ ] 明确普通登录与 URL 桥接是两条入口，但最终都收敛到同一套服务端会话创建流程。
  - [ ] 如果 `dw_datacenter_system_user` 尚未进入受控 staging，则先建立最小目录镜像或只读视图，不让页面层直接依赖 ERP 原始表。
- [ ] 用已同步用户目录替换当前手填 scope 登录表单（AC: 1, 3, 4）
  - [ ] 登录页保留两个主要输入：`account` 与 `password`。
  - [ ] 移除当前开发联调模式下手填 `organizationId`、`projectIds`、`areaIds`、`roleCodes` 的入口，避免继续把权限来源交给浏览器输入。
  - [ ] 账号查询必须保证唯一命中；若命中多条，返回稳定错误，不允许猜测式登录。
- [ ] 实现 URL 免密桥接与安全边界（AC: 2, 3, 4）
  - [ ] 约定 URL 入口参数：`account`，可配合 `next` 跳转目标使用。
  - [ ] 只有当内部桥接显式启用时才允许该入口生效，并在文案和代码中明确其“内部试点/非生产”属性。
  - [ ] 继续复用现有 `sanitizeNextPath()` 与受控跳转策略，不允许把桥接入口变成任意跳转。
- [ ] 接入远端加密接口并固化比较口径（AC: 1, 3）
  - [ ] 通过现有业务接口 `POST /fastify/newsee/handlePassword` 调用 `aesEnOrDeType=encrypt`，用返回体中的 `result` 作为加密结果。
  - [ ] 远端返回 `statusCode !== 200`、`result` 为空、网络失败或响应结构不符合预期时，登录流程必须 fail loud，不允许伪成功。
  - [ ] 当前阶段密码校验口径固定为：输入密码 -> 远端加密 -> 比较 `dw_datacenter_system_user.user_password`。
- [ ] 从用户目录与组织链路推导真实 scope（AC: 1, 4）
  - [ ] 基于 `dw_datacenter_system_user.organizationId` 与组织树路径构建会话内的组织范围。
  - [ ] 通过 `propertyProject` 组织节点映射出 `projectId` / `ownerId` 可访问范围。
  - [ ] 不再把 `areaId` 写入或作为权限判断链路的一部分；`ChargeItem` 查询不加项目级权限裁剪；不要额外建设平台本地权限主数据。
- [ ] 覆盖登录与桥接回归测试（AC: 1, 2, 3, 4）
  - [ ] 测试账号登录成功。
  - [ ] 测试 URL 带 `account` 时可直接进入工作台。
  - [ ] 测试命中 0 条、命中多条、密码错误、用户停用、远端加密接口失败等失败分支。
  - [ ] 测试普通登录与 URL 桥接得到的会话 scope 一致，并且不依赖手填范围参数。

## Dev Notes

- 这个故事的目标不是做生产级 SSO，而是为当前原型 / 内部试点建立“可直接用真实用户目录进入系统”的桥接层。
- 用户已经明确：正常登录仍然需要 `account + password`；只有 URL 携带 `account` 时才走内部免密跳转。
- 由于当前没有 ERP JWT 解密能力，也不掌握对方 token / session 的加密 key，因此本故事不应依赖 ERP 票据校验，而应基于已同步的用户目录完成身份解析。
- 当前密码校验口径已经明确：按 `user_account` 定位用户后，调用远端加密接口：

  ```json
  {"content":"<plain-password>","isBatch":false,"aesEnOrDeType":"encrypt"}
  ```

  当接口返回示例：

  ```json
  {"statusCode":200,"result":"r5deoK7XdPmX6iilAchDKA=="}
  ```

  即使用 `result` 与 `dw_datacenter_system_user.user_password` 比较；若接口失败或响应异常，则登录失败。
- 当前权限模型已经在 Story 4.3 中收敛：`areaId` 不再参与 ACL；`ChargeItem` 不做权限控制；用户 scope 应由组织链路和项目组织映射推出，而不是从登录表单收集。
- 当前 URL 免密属于 `temporary mitigation`：它服务于内部试点和联调效率，不是生产级安全方案；退出条件是后续真实 ERP SSO / token exchange 能稳定替换该桥接入口。

### Architecture Compliance

- 继续通过服务端会话创建登录态，不在浏览器保存可信权限对象。
- 普通登录与 URL 桥接都必须复用同一套 session 创建边界，避免出现两套 scope 推导逻辑。
- 认证实现应继续遵循 `domain -> application -> infrastructure` 分层，application 层不能直接依赖具体 Postgres / ERP 适配实现。
- 该故事是“内部试点登录桥接”，不能被误写成生产级认证方案；真实 ERP SSO / token exchange 仍然可以后续替换这层 adapter。
- 平台不是新的身份源，也不是新的权限权威；本故事不引入本地组织、用户、角色维护后台。

### File Structure Requirements

- 重点文件预计包括：
  - `src/app/(auth)/login/page.tsx`
  - `src/app/api/auth/login/route.ts`
  - `src/app/api/auth/callback/route.ts` 或新增受控桥接 route
  - `src/application/auth/ports.ts`
  - `src/application/auth/use-cases.ts`
  - `src/domain/auth/models.ts`
  - `src/infrastructure/session/server-auth.ts`
  - `src/infrastructure/erp-auth/` 下的目录登录/桥接适配器
  - 如需目录镜像：`src/infrastructure/postgres/schema/` 与受控 repository
  - 新增 `tests/story-7-5-*.test.mjs`

### Testing Requirements

- 至少覆盖：
  - 账号 + 密码登录成功
  - URL 带 `account` 的免密桥接成功
  - 命中多条 / 0 条 / 密码错误 / 用户停用 / 远端加密接口失败
  - 登录成功后的 scope 来源于目录与组织链路，而不是表单手填

### Previous Story Intelligence

- Story 1.2 建立了受保护会话与服务端登录门禁，但当前登录页仍是开发期手填 scope 表单。
- Story 2.3 已将会话持久化到 Postgres，因此本故事应在现有 session 基础上替换身份来源，而不是重新发明会话机制。
- Story 4.3 已经建立 ERP 只读防腐层与真实权限链路，本故事应复用“`user -> org -> 下级项目组织 -> projectId / ownerId -> 业务事实`”这一口径，不再使用 `areaId`。
- 当前用户注入文档 `docs/humen-inejct/4-3/sprint-4-3.md` 已明确给出 `dw_datacenter_system_user`、`organizationId`、`userAccount`、`userTelephone`、`password` / `userPassword` 等字段线索。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.5: 账号/手机号登录与 URL 免密桥接]
- [Source: _bmad-output/planning-artifacts/architecture.md#认证与安全]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: docs/humen-inejct/4-3/sprint-4-3.md#10. 用户与权限关联说明]
- [Source: _bmad-output/implementation-artifacts/4-3-erp-read-anti-corruption-layer-and-scope-filtering-baseline.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Story corrected on 2026-04-11: normal login now明确为 `account + password`，密码通过远端加密接口返回的 `result` 与 `dw_datacenter_system_user.user_password` 比较；只有 URL-carried `account` 才能触发内部免密桥接。
- Story positioned under Epic 7 because it is an internal auth/governance bridge that replaces current development-only scope form without changing the product's main analysis epics.

### File List

- _bmad-output/implementation-artifacts/7-5-account-or-mobile-login-and-url-passwordless-bridge.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/epics.md
