---
title: '统一后台路由与厂字型菜单布局'
type: 'refactor'
created: '2026-05-05'
status: 'done'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 根路由 `/` 是一个无意义的占位 landing 页（展示脚手架骨架、Route Groups 占位说明），用户访问 `/` 看到的是开发笔记而非产品功能。workspace 和 admin 两个路由组各自独立维护布局（侧栏 + 主内容区），没有统一导航菜单、没有跨区域跳转入口、没有共享的厂字型外壳，导致用户在这两个区域之间无法便捷切换，后续新增页面也没有标准挂载点。

**Approach:** 根路由 `/` 直接重定向到 `/workspace`。抽取 workspace 和 admin 的布局共性，构建统一的厂字型外壳组件（顶栏 + 左侧菜单 + 主内容区），定义集中式菜单配置，workspace 和 admin 布局复用同一外壳组件，仅菜单项按路由组区分。

## Boundaries & Constraints

**Always:**
- 根路由 `/` 必须服务端重定向到 `/workspace`（`redirect()` 在 page.tsx 中），不渲染任何 UI
- 厂字型外壳必须包含：顶部横栏（Logo/产品名 + 用户身份 + 退出入口）+ 左侧垂直菜单 + 右侧主内容区
- 菜单配置集中定义，workspace 和 admin 各自声明自己的菜单项，不做运行时动态拼接
- 登录页 `(auth)/login` 不使用外壳布局（未认证用户不应看到管理菜单）
- 已有路由路径不变，已有页面组件不变，仅改变布局包裹方式
- 沿用现有 Tailwind 4、品牌色 Token、glass-panel 等视觉体系

**Ask First:**
- 菜单项的具体名称、顺序、图标（如果有）
- 是否需要面包屑导航
- 移动端菜单是折叠成汉堡菜单还是保持简化

**Never:**
- 不改变路由组语义 `(workspace)` / `(admin)` / `(auth)` 的分组方式
- 不在客户端拼装菜单权限（菜单可见性由服务端 layout 决定）
- 不引入第三方 UI 库（Ant Design、MUI 等）
- 不修改 API 路由
- 不在本 spec 内增加新页面或新业务功能

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 用户访问 `/` | 任意用户 | 服务端 307 重定向到 `/workspace` | N/A |
| 已登录用户访问 workspace | 有效 session | 显示厂字型外壳 + workspace 菜单 + 页面内容 | 未登录重定向到 `/login` |
| 已登录用户访问 admin | 有 ontology 治理权限的 session | 显示厂字型外壳 + admin 菜单 + 页面内容 | 无权限显示 Access Restricted |
| 未登录用户访问 `/login` | 无 session | 仅渲染登录表单，不包裹外壳布局 | N/A |
| 用户在 workspace 和 admin 之间导航 | 点击左侧菜单项 | 页面切换到目标区域，菜单高亮当前项 | N/A |

</frozen-after-approval>

## Code Map

- `src/app/page.tsx` — 根路由，当前是占位 landing 页，改为 redirect
- `src/app/layout.tsx` — 根布局，保持最小化（html + body）
- `src/app/(workspace)/layout.tsx` — 工作台布局，当前内联侧栏，改为使用共享外壳
- `src/app/(admin)/layout.tsx` — 管理后台布局，当前内联侧栏+导航，改为使用共享外壳
- `src/app/(auth)/login/page.tsx` — 登录页，不包裹外壳，保持不变
- `src/app/_components/shell-layout.tsx` — **新建** 统一厂字型外壳组件（顶栏 + 侧栏菜单 + 主内容区）
- `src/app/_components/shell-menu-config.ts` — **新建** 集中式菜单配置

## Tasks & Acceptance

**Execution:**
- [x] `src/app/page.tsx` — 替换为 `redirect('/workspace')` — 消除无意义的 landing 页
- [x] `src/app/_components/shell-menu-config.ts` — 新建菜单配置，定义 workspace/admin 菜单项 — 集中管理导航入口
- [x] `src/app/_components/shell-layout.tsx` — 新建厂字型外壳组件（顶栏 + 左侧菜单 + 主内容插槽） — workspace 和 admin 共享同一外壳
- [x] `src/app/(workspace)/layout.tsx` — 重构为使用 ShellLayout + workspace 菜单配置 — 统一布局入口
- [x] `src/app/(admin)/layout.tsx` — 重构为使用 ShellLayout + admin 菜单配置 — 统一布局入口

**Acceptance Criteria:**
- Given 用户访问 `/`，when 浏览器加载根路由，then 自动跳转到 `/workspace`
- Given 已登录用户访问 `/workspace`，when 页面渲染，then 看到顶栏（Logo + 用户信息 + 退出按钮）+ 左侧菜单 + 主内容区
- Given 已登录用户在 `/workspace`，when 点击左侧菜单中的管理后台入口，then 跳转到 `/admin/ontology`
- Given 已登录用户在 `/admin/ontology`，when 点击左侧菜单中的工作台入口，then 跳转到 `/workspace`
- Given 用户访问 `/login`，when 页面渲染，then 仅显示登录表单，不显示外壳布局（无顶栏、无侧栏菜单）
- Given 用户在 `/admin/ontology/definitions`，when 查看左侧菜单，then 当前活跃菜单项高亮

## Verification

**Commands:**
- `pnpm build` — expected: 构建成功，无类型错误
- `pnpm lint` — expected: 无新增 lint 错误
