---
date: '2026-03-27'
project: 'ontology-agent'
artifact: 'platform-pg-layering-plan'
status: 'draft-ready-for-collaboration'
owner: 'shared'
---

# 平台 PG 分层方案

## 1. 这份方案回答什么

这份方案专门回答下面几个问题：

- 你的业务数据先落到哪里
- 是否只写入 `Postgres` 就够了
- `Cube` 和 `Neo4j` 应该从哪一层取数
- 以后源表变了，会不会频繁改产品代码
- 你负责哪一层，我负责哪一层

## 2. 先说结论

推荐的数据路径是：

```text
外部业务库 / ERP / 另一台服务器
-> 同步工具
-> 平台 PG.raw
-> 平台 PG.staging
-> 平台 PG.canonical
-> 平台 PG.analytics
-> Cube
-> Neo4j
-> 产品分析功能
```

关键结论：

1. 你最先只需要把数据稳定同步到平台 `PG.raw` 或 `PG.staging`
2. 不建议你直接手工同时维护 `PG + Cube + Neo4j` 三份数据
3. `Cube` 和 `Neo4j` 都不应该直接吃你的源库原始表
4. 产品功能不应该直接依赖源表，而应该依赖平台标准化后的分层数据

## 3. 为什么要分层

如果不分层，直接拿源表做产品逻辑，会有几个问题：

- 源表字段改名会直接冲击产品代码
- 历史口径变化会污染分析结果
- `Cube` 和 `Neo4j` 会吃到脏数据
- 权限切片会散落在各处
- 后续排查问题很难定位是哪一层出了错

分层的核心目标是：

- 让源系统变化和产品逻辑解耦
- 让数据清洗有明确位置
- 让指标层和关系层各吃适合自己的数据
- 让同步、排障、回放更可控

## 4. 推荐的 PG 分层

建议在平台 `Postgres` 中至少形成四层逻辑分区。

注意：
不一定非要做成四个物理数据库，也可以是同一个 PG 实例内的不同 schema。

推荐 schema 结构：

- `raw`
- `staging`
- `canonical`
- `analytics`
- `platform`

其中 `platform` 是你现在项目已经在用的平台自有表，不承接业务事实原始数据。

## 5. 各层职责

### 5.1 `raw`

定位：

- 接住外部同步过来的原始数据
- 尽量少改结构
- 便于追溯源数据

特点：

- 表结构尽量接近源系统
- 保留原始字段命名
- 可以带同步批次、来源时间、来源系统标记
- 不建议直接给产品功能使用

适合放：

- 原始收费单
- 原始工单
- 原始投诉
- 原始满意度记录
- 原始项目/楼栋/房间/业主主数据

你负责：

- 把外部数据稳定同步进来

我负责：

- 设计最小接收约定
- 明确哪些字段必须带上

### 5.2 `staging`

定位：

- 第一道清洗层
- 解决基础脏数据问题
- 做字段标准化和基础类型纠正

特点：

- 字段命名开始向平台统一风格靠拢
- 修复空值、重复值、非法枚举、时间格式问题
- 保留一定程度的源表痕迹，便于排查

适合做：

- 时间字段统一成标准时间
- 状态码重映射
- 金额字段转数值
- 去重
- 软删除过滤
- 无效记录剔除

你负责：

- 说明哪些字段有脏数据风险
- 说明历史口径差异

我负责：

- 设计清洗规则
- 形成 staging 表 / view / job

### 5.3 `canonical`

定位：

- 平台统一业务事实层
- 真正给上层能力消费的稳定结构

特点：

- 不再暴露源系统内部命名
- 形成平台稳定契约
- 源系统变化时，优先改 raw/staging 到 canonical 的映射，而不是改产品逻辑

适合放：

- 标准化收费事实
- 标准化工单事实
- 标准化投诉事实
- 标准化满意度事实
- 标准化项目/区域/楼栋/房间/业主实体

这一层最重要，因为：

- `Cube` 应优先从这里往上做
- `Neo4j` 也应从这里投影节点和边
- 产品应用层若要查非聚合业务事实，也应优先依赖这里

你负责：

- 确认业务语义和字段定义

我负责：

- 设计 canonical 模型
- 定义标准字段和稳定契约

### 5.4 `analytics`

定位：

- 面向分析和语义层的消费层
- 为 `Cube` 和部分高频分析查询做优化

特点：

- 可以是汇总表、宽表、分析专用视图
- 不必等同于 canonical
- 为聚合查询和指标口径服务

适合放：

- 月度收缴汇总
- 工单时效分析宽表
- 投诉与满意度联动分析视图
- 项目 / 区域 / 时间粒度汇总表

你负责：

- 确认指标口径

我负责：

- 定义 analytics 派生层
- 对接 `Cube`

### 5.5 `platform`

定位：

- 平台自有业务表

适合放：

- auth sessions
- analysis sessions
- analysis plans
- execution records
- final conclusions
- audit events

不适合放：

- 你的 ERP 原始业务事实大表

## 6. `Cube` 和 `Neo4j` 分别从哪一层取数

### `Cube`

推荐读取层：

- 优先 `analytics`
- 次优 `canonical`

不推荐直接读取：

- `raw`
- 大量未清洗的 `staging`

原因：

- `Cube` 主要负责指标口径和聚合查询
- 它吃的数据应该尽量稳定、结构清晰、便于建 measure/dimension

一句话：

`Cube` 吃“已经适合做指标分析”的数据。

### `Neo4j`

推荐读取层：

- 优先 `canonical`
- 部分关系增强可参考 `analytics`

不推荐直接读取：

- `raw`

原因：

- `Neo4j` 主要负责实体关系和候选影响因素图
- 它需要的是清晰稳定的实体和关系，不是脏的原始流水

一句话：

`Neo4j` 吃“已经适合做关系图投影”的数据。

## 7. 你到底要不要只写 PG

### 最短答案

对你来说，**第一步只写 PG 就可以**。

但这里的“只写 PG”指的是：

- 先把数据同步到平台 PG
- 再由平台把标准化数据继续供给 `Cube` 和 `Neo4j`

不是说：

- 最终系统只需要 PG，完全不需要 `Cube` 和 `Neo4j`

### 更准确的职责划分

你负责：

- 把真实业务数据带进平台 PG

我负责：

- 让 PG 分层合理
- 让 `Cube` 从正确层取数
- 让 `Neo4j` 从正确层取数
- 让产品功能不直接依赖你的源表

## 8. `Cube` 和 `Neo4j` 是不是设计好就不用动

都不是“一次设计永不变化”，但变化方式不同。

### `Cube` 的变化方式

通常会变化：

- 新增指标
- 修改口径
- 增加维度
- 调整预聚合

通常不需要频繁变化：

- 与源表的强耦合结构

所以：

`Cube` 更像一个持续演进的语义层。

### `Neo4j` 的变化方式

通常会变化：

- 新增节点类型
- 新增边类型
- 调整关系投影规则
- 扩充候选影响边

通常不应频繁变化：

- 在线请求里随意写图结构

所以：

`Neo4j` 更像一个持续演进的关系投影层。

## 9. 推荐的协作边界

### 你现在最应该负责的部分

第一阶段只要确保：

1. 源系统有可同步的表
2. 同步工具能把表带到平台 PG
3. 我们一起确认字段语义和关系语义

### 你现在不需要负责的部分

- 自己手工把数据三份分别灌到 `PG / Cube / Neo4j`
- 自己先把 `Cube` 模型全部建完
- 自己先把 `Neo4j` 图谱全部建完
- 自己猜产品到底会怎么消费这些数据

## 10. 每层建议放什么

下面给一个建议样例。

### `raw`

- `raw_fee_bill`
- `raw_work_order`
- `raw_complaint`
- `raw_satisfaction_record`
- `raw_project`
- `raw_building`
- `raw_room`
- `raw_owner`

### `staging`

- `stg_fee_bill_clean`
- `stg_work_order_clean`
- `stg_complaint_clean`
- `stg_satisfaction_clean`
- `stg_project_clean`

### `canonical`

- `fact_fee_bill`
- `fact_work_order`
- `fact_complaint`
- `fact_satisfaction`
- `dim_project`
- `dim_area`
- `dim_building`
- `dim_room`
- `dim_owner`

### `analytics`

- `mart_fee_collection_monthly`
- `mart_work_order_sla_daily`
- `mart_complaint_rate_monthly`
- `mart_satisfaction_trend_monthly`
- `mart_project_service_quality`

### `platform`

- `platform.auth_sessions`
- `platform.analysis_sessions`
- `platform.analysis_plans`
- `platform.analysis_executions`
- `platform.analysis_conclusions`

## 11. 对应当前 story

### `Story 4.3`

负责落地：

- 源系统 -> `raw/staging/canonical`
- 权限切片
- 字段映射
- 基础清洗

### `Story 4.4`

负责落地：

- `canonical/analytics` -> `Cube`

### `Story 4.5`

负责落地：

- `canonical` -> `Neo4j`

### `Story 4.6`

负责落地：

- 把 `PG + Cube + Neo4j + LLM` 统一编排给产品使用

## 12. 我建议你下一步实际提供什么

如果要开始落地，下一步你给我这些就最有用：

```text
1. 第一批业务域（建议先 1-2 个）
2. 源表清单
3. 每张表主键、外键、时间字段
4. 哪些表你打算同步到平台 PG
5. 你现在同步工具能做到表级同步，还是只能 SQL/脚本抽取
6. 3-5 个核心指标
7. 关键实体关系
8. 已知脏数据问题
```

## 13. 最终建议

如果你现在只想抓一个最稳的原则，那就是：

**先把“外部业务库 -> 平台 PG”打通。**

然后：

- `Cube` 从平台 PG 的 `analytics/canonical` 取数
- `Neo4j` 从平台 PG 的 `canonical` 取数

这样以后源表变动，优先改同步和映射层，不直接冲击产品功能层。
