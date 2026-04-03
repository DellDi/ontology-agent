# Cube 语义层基线（Story 4.4）

## 目标

本文件定义 Story 4.4 首批进入 Cube 语义层的指标基线，目的是让上层分析编排只消费统一的 metric contract，而不是在业务代码里重复拼指标口径。

当前基线优先覆盖两类主题：

- 收费
- 工单

## 首批指标

| 指标 Key | 中文名称 | 业务定义 | 当前公式 | 主事实主题 | 默认时间维度 | 备注 |
|---|---|---|---|---|---|---|
| `collection-rate` | 收缴率 | 在统一治理口径下的实收 / 应收本金 | `paid_amount / charge_sum` | 收费 | `business-date` | 分母已确认使用 `chargeSum` |
| `receivable-amount` | 应收金额 | 在统一治理口径下的应收金额汇总 | `sum(receivable_amount)` | 收费 | `business-date` |  |
| `paid-amount` | 实收金额 | 在统一治理口径下的实收金额汇总 | `sum(paid_amount)` | 收费 | `business-date` |  |
| `service-order-count` | 工单总量 | 工单主题内的工单数量 | `count(service_order_id)` | 工单 | `created-at` |  |
| `complaint-count` | 投诉量 | 工单主题中 `service_style_name = 投诉` 的数量 | `count(service_order_id where complaint)` | 工单（投诉子集） | `created-at` |  |
| `average-satisfaction` | 平均满意度 | 基于工单 `satisfaction` 字段的平均值，并保留 `satisfactionEval` 作为客户评价满意度语义 | `avg(satisfaction)` | 工单（满意度派生） | `completed-at` | 同时纳入 `satisfactionEval` |
| `average-close-duration-hours` | 平均关闭时长 | 工单从创建到完成的平均时长（小时） | `avg(completed_at - created_at)` | 工单 | `completed-at` | 保留 |
| `average-response-duration-hours` | 平均响应时长 | 工单从创建到首次响应的平均时长（小时） | `avg(first_response_at - created_at)` | 工单 | `created-at` | 已纳入正式语义契约 |

## 维度与权限切片

当前统一支持的核心维度：

- `organization-id`
- `project-id`
- `project-name`
- `charge-item-name`
- `service-style-name`
- `service-type-name`

权限切片原则：

- 所有指标查询都必须带入 `organizationId`
- 如果当前会话已有 `projectIds`，则查询必须继续收窄到项目范围
- `ChargeItem` 不单独做权限裁剪，但收费类指标仍通过组织 / 项目范围裁剪事实数据
- `areaId` 不作为当前权限链的一部分

## 数据来源口径

首批语义层建立在 Story 4.3 已完成的受控 read boundary 之上，不应直接裸连 ERP 原始主写表。

当前来源约束：

- 收费主题：基于应收与实收主题
- 工单主题：基于工单表
- 投诉主题：从工单主题切分，不单独建物理投诉表
- 满意度主题：复用工单 `satisfaction` 与 `satisfactionEval` 字段

## 已确认业务口径

你当前已经确认的口径如下：

1. 收缴率分母使用 `chargeSum`
2. 工单时效同时保留“响应时长”和“关闭时长”
3. 满意度继续以工单满意度为主，同时纳入 `satisfactionEval` 作为客户评价满意度语义

## 后续实现提醒

- `average-close-duration-hours` 与 `average-response-duration-hours` 都已纳入当前 Story 4.4 的正式 metric contract
- `satisfactionEval` 当前已纳入口径说明；如果后续需要把“满意 / 很满意 / 一般 / 不满意 / 很不满意”做成单独统计指标，可在下一轮语义指标扩展里新增枚举分布指标

## 设计约束

- 上层代码只能使用平台内部的 metric contract，不直接拼 Cube 原始 query object
- 任何新指标都应先登记到语义指标目录，再暴露给分析编排层
- 如果业务定义发生变化，应优先更新这里和语义层目录，而不是在执行故事中临时修正
