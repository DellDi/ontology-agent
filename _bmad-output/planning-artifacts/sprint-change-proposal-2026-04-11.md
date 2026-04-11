---
date: '2026-04-11'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'moderate'
approved_date: '2026-04-11'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

当前 `Epic 7` 的认证主线存在“文档方向部分正确、实际故事边界仍偏宽、当前实现仍停留在开发 stub”的三重错位：

- 当前代码登录入口仍要求浏览器手填 `organizationId / projectIds / areaIds / roleCodes`
- `Story 7.5` 仍写成“账号/手机号 + URL account/mobile”
- 当前认证/权限语义里还残留较重的 `areaId` / `role` 口径，容易继续把平台推向一套新的本地权限系统

### 问题类型

这是一次 **执行阶段发现的需求误读与实现偏航修正**，性质属于：

- stakeholder 新澄清需求
- 对原始业务边界的误解需要收口
- 不是推翻 Epic 7，而是把认证桥接故事纠偏到更窄、更真实的业务目标

### 核心问题陈述

本项目当前认证目标应当是：

- 基于物业 ERP 已同步的 `dw_datacenter_system_user` 完成账号登录
- 普通登录口径固定为 `user_account + password`
- 密码校验口径固定为“调用远端加密接口 -> 比较 `user_password`”
- URL 免密仅支持 `account`
- scope 由 `user -> org -> propertyProject -> projectId / ownerId -> 业务事实` 在服务端推导
- 平台只持有最小服务端 session，不重新建设本地组织/用户/RBAC 权威

当前文档与实现的偏差如果不纠正，后续风险包括：

- 团队继续实现手机号登录等未确认范围
- 继续保留浏览器手填 scope，掩盖真正权限来源
- 继续把 `areaId`、`roleCodes` 当作长期权限模型
- 在产品内逐步长出一套新的组织/用户权限系统

### 支撑证据

- 用户口头澄清：当前目标不是再做一套组织用户架构权限系统
- 用户明确补充：普通登录按账号密码；URL 免密按账号；当前安全性不是主优先级
- 用户提供的远端加密接口返回示例：

  ```json
  {"statusCode":200,"result":"r5deoK7XdPmX6iilAchDKA=="}
  ```

- [docs/humen-inejct/4-3/sprint-4-3.md]({project-root}/docs/humen-inejct/4-3/sprint-4-3.md) 已给出：
  - `dw_datacenter_system_user.userAccount`
  - `dw_datacenter_system_user.userPassword`
  - `dw_datacenter_system_user.organizationId`
- [4-3-erp-read-anti-corruption-layer-and-scope-filtering-baseline.md]({project-root}/_bmad-output/implementation-artifacts/4-3-erp-read-anti-corruption-layer-and-scope-filtering-baseline.md) 已确认 `areaId` 不再是 ERP ACL 主链路

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发故事为 `Story 7.5`
- `1.2` [x] Done：问题类型为“stakeholder 新澄清需求 + 原始需求误读”
- `1.3` [x] Done：已有用户澄清、ERP 用户表字段、现有故事文本与当前代码作为证据

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：`Epic 7` 仍可继续，不需要回滚
- `2.2` [x] Done：需要修改 `Story 7.5` 的标题、AC、任务、测试口径
- `2.3` [x] Done：`Story 7.1` 与现有 auth 实现后续需要跟随收口，但本次先不改 story 编号和 epic 结构
- `2.4` [N/A]：不需要新增 epic
- `2.5` [x] Done：优先级不变，但 `7.5` 的需求边界必须先收正，再进入开发

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 不冲突，属于实现口径和故事边界收口
- `3.2` [x] Done：Architecture 主文档不需要立即改，但认证与安全的实现说明应遵循“平台不是新身份源”
- `3.3` [x] Done：登录页 UX 文案后续需要从“ERP 账号 + 手填 scope”改为“账号 + 密码”
- `3.4` [x] Done：测试策略、server auth、session scope、后续授权 story 都受影响

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：直接调整 `Story 7.5` 并保持 Epic 7 结构不变
- `4.2` [ ] Not viable：不建议回滚 `Story 1.2 / 2.3 / 4.3`
- `4.3` [ ] Not viable：不需要改 MVP，只需要收紧实现范围
- `4.4` [x] Done：推荐 `Option 1: Direct Adjustment`

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [ ] Action-needed：等待用户批准
- `6.4` [N/A]：本次不新增/删除 epic 或 story 编号，`sprint-status.yaml` 无需变更

## 3. 影响分析

### Epic 7 的影响

- `Epic 7` 主线不变
- `7.5` 从“可选手机号目录登录”收口为“账号密码登录 + URL 账号免密桥接”
- `7.1` 后续实现时应去掉 `areaId` 作为长期权限判断主链路的依赖，并避免继续强化本地 role 语义

### Story 7.5 的影响

- 需要修改标题、故事描述、AC、任务清单、测试要求、Dev Notes
- 需要把远端加密接口作为正式认证契约的一部分写清楚
- 需要把“平台不是新的权限权威”写入 Architecture Compliance

### 现有代码的影响

- 登录页将从手填 scope 表单切换为 `account + password`
- `server-auth` 和 `application/auth` 需要新增目录查询与远端加密验密能力
- 当前 `areaIds` / `roleCodes` 在 session 和展示层仍有历史残留，属于后续开发时需要清理的已知偏差

### UX / 测试的影响

- 登录文案应强调“复用 ERP 同步账号”而非“模拟 ERP scope 输入”
- 测试要新增远端加密接口失败、返回结构异常、`statusCode != 200` 等失败分支

## 4. 推荐路径

### 选定方案

**Direct Adjustment**

### 具体建议

1. 立即修正文档，把 `Story 7.5` 收口到账号登录与 URL 账号免密。
2. 保持 `Epic 7` 编排顺序不变，不新增 story 编号。
3. 后续直接进入 `DS` 执行该故事，并把现有 dev stub 替换为真实目录登录桥接。

### 理由

- 变更范围集中，主要是认证桥接 story 的需求收口
- 不涉及推翻既有架构成果
- 能直接避免团队继续实现手机号、手填 scope、本地权限主数据等错误方向
- 与用户最新澄清完全一致，且能最快转化为可开发任务

### 风险评估

- 实施工作量：中
- 返工风险：低到中
- 长期收益：高

## 5. 详细变更提案

### 5.1 Story 文本修改

Story: `7.5`
Section: Title / Story / Acceptance Criteria / Tasks / Dev Notes / Testing

OLD:

- `账号/手机号登录与 URL 免密桥接`
- `account/mobile + password`
- `account or mobile` URL bridge
- 失败分支未明确远端加密接口失败

NEW:

- `账号密码登录与 URL 账号免密桥接`
- 普通登录只支持 `account + password`
- URL 只支持 `account`
- 密码校验明确为：远端加密接口返回 `result` 与 `dw_datacenter_system_user.user_password` 比较
- 平台不新增本地组织/用户/RBAC 权威

Rationale:

- 这是用户已明确确认的真实业务边界
- 可以直接防止 story 继续向手机号和本地权限系统扩 scope

### 5.2 Epic 文本修改

Artifact: `epics.md`
Section: `Story 7.5`

OLD:

- 账号或手机号登录
- URL 中包含账号或手机号
- 成功后带入组织、项目与角色范围

NEW:

- 账号密码登录
- URL 中仅包含账号
- scope 来自用户目录与组织链路，平台不新建本地权限权威

Rationale:

- 让 epic 主文档与 story 文档对齐，避免 backlog 执行再次走偏

### 5.3 架构执行约束

Artifact: `Story 7.5 Architecture Compliance / Dev Notes`

NEW:

- 平台不是新的身份源
- 平台不是新的权限权威
- URL 免密为内部试点 `temporary mitigation`
- 退出条件是后续真实 ERP SSO / token exchange 落地

Rationale:

- 防止临时桥接方案被误当成长期正式安全方案

## 6. 实施交接

### 变更范围分类

`Moderate`

### 推荐交接对象

- `Developer agent`

### Developer 下一步责任

1. 基于已修正的 `Story 7.5` 实现目录查询、远端加密验密、URL `account` 免密桥接
2. 移除浏览器手填 scope 的入口
3. 在会话与授权链路中清退 `areaId` 的长期主链路地位
4. 为远端加密接口失败与响应异常补回归测试

### 成功标准

- 用户能用 `user_account + password` 登录
- URL `account` 能直接建立受保护 session
- scope 仅由服务端根据 ERP 同步关系推导
- 平台内没有新增本地组织/用户/RBAC 权威
