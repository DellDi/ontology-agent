# Cube 语义层基线（Story 4.4）

## 目标

本文件定义当前进入 Cube 语义层的正式指标契约。收费指标不再使用模糊的 `business-date` 统一解释，而是拆成两套明确口径：

- 项目口径
- 尾欠口径

两套口径共享同一组组织 / 项目权限边界，但使用不同的应收时间语义。

## 收费指标正式语义

### 项目口径

项目口径表示“当年全年正常应收账单”：

- 应收来源：`erp_staging.dw_datacenter_charge`
- 应收过滤：
  - `isDelete = 0`
  - `isCheck = '审核通过'`
  - `chargeItemType = '1'`
- 应收金额字段：`actualChargeSum`
- 应收时间语义：`shouldAccountBook`，即“应收账期”
- 实收来源：`erp_staging.dw_datacenter_bill`
- 实收过滤：
  - `isDelete = 0`
  - `isEnterAccount = 1`
  - `(refundStatus IS NULL OR refundStatus != '待退款')`
  - `precinct_collection_type != 1`
  - `subjectCode` 在默认业务标志集合内
- 实收金额字段：`chargePaid`
- 实收时间语义：`operatorDate`，缺失时退回 `paidYear/paidMonth/paidDay`

### 尾欠口径

尾欠口径表示“跨年未收的历史欠费账单”：

- 应收来源与公共过滤与项目口径相同
- 应收金额字段：`actualChargeSum`
- 应收时间语义：`calcEndDate / calcEndYear`
- 在实现里，尾欠 cohort 通过 `billing-cycle-end-date` 语义窗口圈定：
  - 下界固定为历史起点
  - 上界为统计年份的 `01-31`
- 实收来源、过滤与金额字段与项目口径相同
- 实收时间语义仍为 `payment-date`

## 首批正式指标

| 指标 Key | 中文名称 | 来源主题 | 默认时间语义 |
|---|---|---|---|
| `project-collection-rate` | 项目口径收缴率 | 应收 + 实收 | `receivable-accounting-period` |
| `project-receivable-amount` | 项目口径应收金额 | 应收 | `receivable-accounting-period` |
| `project-paid-amount` | 项目口径实收金额 | 实收 | `payment-date` |
| `tail-arrears-collection-rate` | 尾欠口径收缴率 | 应收 + 实收 | `billing-cycle-end-date` |
| `tail-arrears-receivable-amount` | 尾欠口径应收金额 | 应收 | `billing-cycle-end-date` |
| `tail-arrears-paid-amount` | 尾欠口径实收金额 | 实收 | `payment-date` |
| `service-order-count` | 工单总量 | 工单 | `created-at` |
| `complaint-count` | 投诉量 | 工单 | `created-at` |
| `average-satisfaction` | 平均满意度 | 工单 | `completed-at` |
| `average-close-duration-hours` | 平均关闭时长 | 工单 | `completed-at` |
| `average-response-duration-hours` | 平均响应时长 | 工单 | `created-at` |

兼容别名：

- `collection-rate` -> `project-collection-rate`
- `receivable-amount` -> `project-receivable-amount`
- `paid-amount` -> `project-paid-amount`

## 收缴率计算

正式口径：

- `收缴率 = 实收 / 应收 * 100`
- 仅当 `应收 > 0` 时输出
- 精度：`ROUND(value, 4)`

语义层实现上，收缴率不再直接绑定到单个 Cube measure，而是通过：

- 分子：对应口径下的 `paid-amount`
- 分母：对应口径下的 `receivable-amount`
- 在 adapter 层组合为最终 `collection-rate`

## 明确时间语义

| 语义 Key | 含义 | 底层字段 |
|---|---|---|
| `receivable-accounting-period` | 应收账期 | `shouldAccountBook` |
| `billing-cycle-end-date` | 计费结束日期 | `calcEndDate / calcEndYear` |
| `payment-date` | 实收日期 | `operatorDate` / `paidYear` / `paidMonth` / `paidDay` |
| `created-at` | 工单创建时间 | `create_date_time` |
| `completed-at` | 工单完成时间 | `accomplish_date` |

`business-date` 仅保留为 legacy alias，不再作为收费主题的正式建模语义。

## 设计约束

- 上层分析编排只消费平台内部 metric contract，不直接手写 Cube query。
- 收费主题必须显式区分“应收 cohort 时间语义”和“实收支付时间语义”。
- 项目口径和尾欠口径必须作为一等指标存在，不能再通过同一个泛化 Finance 指标硬混。
