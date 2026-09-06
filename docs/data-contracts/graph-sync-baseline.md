# Neo4j 图谱同步基线（Story 4.5）

## 目标

本文件定义首批进入图谱层的实体、关系边与同步来源，确保候选因素扩展与关系推理来自受控的 Neo4j baseline，而不是运行时随手写图。

运行时交付与持续同步方案见：

- [Java Graph Sync 运行模型](./graph-sync-operating-model.md)

## 首批实体

- Organization
- Project
- ChargeItem
- Receivable
- Payment
- ServiceOrder
- Complaint
- Satisfaction

## 首批关系

- Organization -> Project
- Project -> Receivable
- Project -> Payment
- Project -> ServiceOrder
- ChargeItem -> Receivable
- ChargeItem -> Payment
- ServiceOrder -> Complaint
- ServiceOrder -> Satisfaction

## 来源说明

- `property-organization`、`property-project`、`property-charge-item`
  - 组织、项目与收费项目 canonical 主数据关系；
- `property-receivable`、`property-payment`、`property-service-order`
  - 应收、实收、工单、投诉与满意度 canonical 事实关系；
- 每个节点和边必须保存 `datasetVersionSetId`、`sourceProductKey` 与 `productVersionId`，writer
  校验产品版本属于同一个 frozen set。

当前六产品没有 `property-owner` 或 `property-house`，因此 P5 不生成 Owner/House 节点及关系。未来只有在
增加对应 canonical product 与真实消费者后才能扩展，禁止借用其他产品版本伪造。

## 受控写入原则

- 运行时分析请求不得直接写入 Neo4j
- 所有写入必须通过受控 sync/import 流程
- 图谱边必须带来源产品、产品版本、方向和解释语义；
- evidence 读取前必须确认目标 set 的 `GraphProjection(status=complete)`，未就绪时明确失败。

## 已确认业务口径的映射提醒

- 收缴率分母使用 canonical `receivable_amount`（来源业务字段 `actualChargeSum`）
- 工单时效同时保留“响应时长”和“关闭时长”
- 满意度以 `satisfaction` 为主，同时纳入 `satisfactionEval`

这些口径应作为后续图谱节点属性或因果边说明的重要上下文，而不是在候选因素展示层临时拼接
