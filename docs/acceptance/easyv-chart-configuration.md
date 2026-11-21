# EasyV 图表规则与后台配置审计接入

当前状态（2026-11-05）：test 已完成 V35、正式 RECONCILE 采集及 Web/API/Cube/发布 Worker 更新，实际统计与权限验证通过。集合 `ingest-650b7225-0f93-4404-bbd6-3edf665dfc84`；本地业务快照未同步。下方早期准备与阻塞记录按执行顺序保留，以本节末最终回执为准。

本次目标是让已有分析链路解释“有哪些图表可用、适合什么场景、分类如何分布、后台配置如何变化”。沿用 source dataset → frozen data product → 本体 → Cube 统计 / 对象读取；没有新增独立统计服务或页面。

## 数据与权限

| 源表 | 产品 / 对象 | 使用口径 |
|---|---|---|
| ai_chart_type_mapping | easyv-chart-type | 配置数量、启停状态、图表组件标识、适用条件 |
| ai_chart_category | easyv-chart-category | 保序分类成员；成员关系数与去重分类数分开 |
| ai_scene_chart_priority | easyv-chart-priority | 保留推荐层级和层内顺序；推荐关系数与去重场景数分开 |
| ai_block_admin_audit | easyv-config-audit | 后台配置日志、前后态是否留存；仅平台管理员 |

三张配置表是面向已有 EasyV 分析账号的全局参考数据。原型组件可以按 chartFamily 下钻到图表配置，配置不能反向暴露业务对象。自动关联数量仍只统计业务对象，规则通过显式关系读取。四类对象均支持既有集合、详情、筛选、统计和统计下钻契约。

分类与场景即使没有成员也保留对象，空记录不计成员/推荐关系数；重复或不存在的图表引用、非法 JSON、非法状态会阻止发布。分类/场景产品同时冻结图表字典依赖，变更后旧版本不重写。源端是 varchar/text JSON，契约按真实 JDBC 类型声明。

后台审计不代表用户修改大屏；operator 是后台令牌标识，不采集。源 before_json 缺失时保留缺失，只有前后态都存在才计入“前后态齐备记录数”。配置是采集时的规则，不证明历史生成时使用过该规则；is_fallback / fallback 推荐也不是实际降级次数。不能据此直接计算选型正确率、用户改屏率。

## 运行与验收

- 平台增加 V35 迁移；源库 SQL 不由本项目执行。
- 发布入口 compose.easyv-dev.yaml 已加入四个产品，采集角色须具备四张源表 SELECT 权限；缺表/权限错误应修正源配置，不跳过。
- 旧冻结集不会被补造配置，规划目录只展示当前冻结集可用且账号有权查询的对象。首次需要在正式发布中同时包含既有业务产品与四个新增产品。
- 本地快照导出/导入与版本清理沿用既有流程，已包含新事实表。
- 可用问题：“统计 EasyV 启用与停用图表配置数”“列出趋势分析的首选、次选与兜底图表”“统计图表分类数及成员关系数”；管理员还可问“按配置表、变更类型统计后台配置审计，并列出缺少前态的记录”。

2026-11-05：验证使用独立本机 Testcontainers，覆盖真实源 JDBC 类型的采集/发布、关系展开、不可变版本、非法输入失败与普通账号/管理员权限；Cube 重写覆盖参考配置冻结、混合业务查询范围和审计拒绝。没有连接公司库、执行公司迁移/采集、发布服务或刷新本地业务快照。真实业务验收须在 easyv-dev 正式发布并采集后进行。此处不把测试容器数据描述为真实业务数据。

这次未扩展模板布局与核心容器的分析模型；本目录内已有方案/槽位产品保持原链路。模板适用性与生成质量的联合判定需要后续独立业务口径。

工程验证：Java 全量回归发现的问题已修正并定向复验，最终测试报告合计 898 项通过；Web 契约回归 215 项通过、5 项容器场景按既有开关跳过；Java 打包与 Web 生产构建通过。V35 覆盖空库、已有迁移历史及已有业务表但无历史的重复执行，不产生重复外键。

## 2026-11-05 test 发布准备

用户已授权 test 采集与发布。已连接 easyv-dev，现网仍为 2026-10-27 镜像、平台 V33，预检无活动分析/发布任务。发布包来自本次已测工作树（未提交），版本 `chart-config-20261105-e2e15d1c92`；Java/Web 镜像已构建并核对 OCI revision、源归档摘要及 JAR 摘要。现网服务尚未改变。

平台完整备份位于 `/opt/ontology-agent-backups/chart-config-20261105/ontology-agent-ontology_agent_test-20261105161744.dump`，约 56 MB、0600，目录 0700，`pg_restore -l` 校验通过；没有执行恢复。保护基线已记录 24 张表与 134 个旧产品版本。

阻塞：沿用的 saas-test 源连接可达，四张新增表均存在、所有者为 `easyv`，但现有只读采集角色 `ontology_agent_ingest` 均无 SELECT 权限。未改用高权限账号采集，也未迁移、采集或切换服务。须由源表所有者在正确的 test 源 `easyv` 数据库执行：

```sql
GRANT SELECT ON easyv_saas.ai_chart_type_mapping,
  easyv_saas.ai_chart_category,
  easyv_saas.ai_scene_chart_priority,
  easyv_saas.ai_block_admin_audit TO ontology_agent_ingest;
```

授权完成后复验四表只读契约，再进行 V33→V35、正式 RECONCILE、配套 Cube/API/Web/发布 Worker 更新及健康核对。远端准备回执 `/opt/ontology-agent-releases/chart-config-20261105-e2e15d1c92/deployment-report.json`，状态为 `prepared-awaiting-source-select-grants`，不代表发布成功。

### 授权连接与迁移进展

用户随后明确授权使用 EasyV 仓库 `application-test.yml` 中既有的 test 数据源凭据执行只读查询和本次采集。已核对该连接与现有采集连接命中同一 `easyv/easyv_saas` 源；四表源数量分别为 15、5、9、0。没有执行源 GRANT，也没有修改源业务数据。

本次一次性采集进程临时采用该业务连接，`requireReadOnlyRole=false` 仅作用于该进程；DataSource 默认只读、事务管理器强制只读、连接器验证 `READ ONLY REPEATABLE READ` 均保留。凭据通过 SSH stdin 与进程环境注入，不写入新凭据文件或应用镜像。此为用户明确要求的 temporary mitigation：根因是原只读角色缺四表 SELECT；退出条件是原角色获得四表只读权限后恢复标准采集。常驻发布 Worker 仍沿用原只读角色和 `requireReadOnlyRole=true`；新增四表的后续持续刷新仍需要补齐原角色 SELECT。

维护前已再次完整备份，路径 `/opt/ontology-agent-backups/chart-config-20261105-maintenance/ontology-agent-ontology_agent_test-20261105162759.dump`，目录 0700、文件 0600，备份目录校验通过。V33→V35 迁移完成。为缩短维护窗口，独立 RECONCILE 执行期间先恢复新版 Web/API/Cube，健康检查通过；应用继续使用上一个完整冻结集，不消费半成品。

### 最终发布与验收回执

- 公司 test 版本 `chart-config-20261105-e2e15d1c92`，Java/Web/Cube 与发布 Worker 均已更新；平台 V35。Web/API/Cube healthy，发布 Worker 运行且无重启，CubeStore 与 Valkey 容器身份保持。部署 JAR SHA-256 与已测发布包一致。
- 正式源任务 `d34a766e-4530-3658-b6da-9f97209609af`，一致性源快照于 **2026-11-05 16:29:17 Asia/Shanghai** 观察。集合 `ingest-650b7225-0f93-4404-bbd6-3edf665dfc84` 于 **16:38:47** 完整冻结；冻结完成时间不等同于源数据观察时刻。
- 13 类产品：应用 277、原型任务 258、布局 258、区域 2,017、组件 3,879、流程节点 9,156、页面生成任务 721、反馈 2,758、方案 89，及下表四类新增产品。258 份布局全部 `parse_status=ok`。后续只读查询源端为 9,166 条节点，观察时点不同；本次保留一致性源快照的 9,156 条，不回填已冻结集合。

| 新增产品 | 业务对象数量 | 物化关系行 |
|---|---:|---:|
| 图表配置 | 15（启用 14、停用 1） | 15 |
| 分类 | 5 | 13 个成员关系 |
| 场景推荐 | 9 | 24 个推荐关系 |
| 后台配置审计 | 0（源表为空） | 0 |

实际 Cube 服务验证了以上 7 个指标、受限账号的组件→图表关联查询（9 个分组）、普通账号审计拒绝及不存在业务主体的范围隔离。登录页 200，匿名 Java/BFF 业务请求 401。没有重复自然语言业务问题或将此描述为浏览器全流程验收。

维护前后 **24 张保护表、134 个旧产品版本**的数量与内容指纹一致。未清理或恢复数据库、未修改源数据、未执行 GRANT、未启用源写回；采集周期保持关闭，既有每日版本保留策略保持。一次性采集容器退出后自动删除，授权业务连接没有写入常驻服务配置。远端回执状态为 `deployed-and-verified`，本机副本 `.codex-runtime/chart-config-20261105/company-deployment-report.json`。

后续刷新边界：常驻发布 Worker 仍使用原 `ontology_agent_ingest` 只读账号，尚缺新增四表 SELECT；本次按用户授权使用 test 配置连接完成一次性采集。后续要由工作台正常持续刷新这四类数据，仍应补齐该只读角色权限。本次未迁移本地库或同步本地快照，3000 与公司 test 的新集合不会自动同步。
