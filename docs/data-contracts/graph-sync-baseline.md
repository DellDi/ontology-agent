# Neo4j 图谱同步基线（Story 4.5）

## 目标

本文件定义首批进入图谱层的实体、关系边与同步来源，确保候选因素扩展与关系推理来自受控的 Neo4j baseline，而不是运行时随手写图。

## 首批实体

- Organization
- Project
- House
- Owner
- ChargeItem
- Receivable
- Payment
- ServiceOrder
- Complaint
- Satisfaction

## 首批关系

- Organization -> Project
- Project -> Owner
- Project -> Receivable
- Project -> Payment
- Project -> ServiceOrder
- ChargeItem -> Receivable
- ChargeItem -> Payment
- ServiceOrder -> Complaint
- ServiceOrder -> Satisfaction

## 来源说明

- `erp-master-data`
  - 组织、项目、业主等主数据关系
- `erp-derived`
  - 应收、实收、工单、投诉、满意度等由 staging 事实投影出的关系
- `governed-rule`
  - 治理后的因果边、候选因素边与解释语义

## 受控写入原则

- 运行时分析请求不得直接写入 Neo4j
- 所有写入必须通过受控 sync/import 流程
- 图谱边必须带 `source`、`direction`、`explanation`

## 已确认业务口径的映射提醒

- 收缴率分母使用 `chargeSum`
- 工单时效同时保留“响应时长”和“关闭时长”
- 满意度以 `satisfaction` 为主，同时纳入 `satisfactionEval`

这些口径应作为后续图谱节点属性或因果边说明的重要上下文，而不是在候选因素展示层临时拼接
