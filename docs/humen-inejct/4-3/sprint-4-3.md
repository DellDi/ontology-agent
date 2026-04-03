可以，我按你补充后的口径，直接给你一份 **可交给 AI 做下一步编排/代码计划的说明文档**，不走 YAML。

---

# 物业 AI 原生架构开发说明文档（Sprint 4.1）

## 1. 文档目的

本文档用于给编排智能体 / AI 开发助手提供当前阶段可落地的业务数据上下文，支撑下一步进行：

* Ontology（本体）建模
* 实体关系梳理
* Skill / Workflow 初步拆分
* SQL / Repository / DTO / 接口草案生成
* 面向收费、工单、投诉、满意度、权限的第一轮 AI 原生架构规划

当前阶段聚焦以下主题：

1. 组织层级
2. 项目 / 小区
3. 收费（收费项目、应收、实收、欠费）
4. 工单
5. 投诉
6. 满意度
7. 用户权限与组织权限链路

---

# 2. 当前建模原则

## 2.1 统一口径

在当前 Sprint 4.1 阶段，建议 AI 按以下统一口径理解：

* **项目 / 小区**：当前统一按 `dw_datacenter_precinct` 建模，主键使用 `precinctID`
* **投诉**：不单独使用独立投诉表，**直接复用工单表 `dw_datacenter_services`**
* **满意度**：不单独使用问卷表，**直接复用工单表中的满意度字段**
* **权限**：用户先关联组织，再通过组织路径及项目组织映射实现组织/项目级数据裁剪

## 2.2 当前最小可行主题模型

当前已足够支撑第一版 AI 原生主题模型：

* 组织 Organization
* 项目 Project
* 房产 House
* 业主 / 客户 Owner / Customer
* 收费项目 ChargeItem
* 应收 Receivable
* 实收 Payment
* 欠费 Arrears
* 工单 ServiceOrder
* 投诉 Complaint（工单子集）
* 满意度 Satisfaction（工单派生）
* 用户 User
* 权限链路 PermissionScope

---

# 3. 组织层级说明

## 3.1 主表

组织信息主表：

`dw_datacenter_system_organization`

## 3.2 关键字段

### 组织主键与上下级关系

* `sourceId`：组织 ID
* `organizationParentId`：父级组织 ID
* `organizationPath`：组织路径，示例 `/240/2853/2858/`
* `organizationLevel`：组织层级深度

其中：

* `organizationParentId` 表示直接父子关系
* `organizationPath` 表示完整祖先链路，用于权限继承和范围裁剪

### 组织名称字段

* `organizationName`：组织名称
* `organizationShortName`：组织简称

### 组织归属字段

* `enterpriseId`：企业 ID
* `groupId`：集团 ID
* `companyId`：公司 ID
* `departmentId`：部门 ID

### 状态字段

* `organizationEnableState`：启用状态
* `isDeleted`：是否删除

---

## 3.3 组织层级字典的真实口径

当前组织层级的真实业务字典，以 `organizationNature` 为准，取值如下：

* 集团公司 = `controllingCompany`
* 区域分公司 = `areaDevision`
* 城市分公司 = `cityDevision`
* 片区 = `district`
* 项目 = `propertyProject`

注意：

* 表注释中 `organizationNature` 的“0集团/1公司/2部门/3虚拟节点”口径**不可信或已过期**
* 在当前 AI 编排和代码规划中，**必须以你补充的业务字典为准**
* `propertyProject` 节点即项目对应的组织节点

---

## 3.4 项目组织的挂接关系

项目主数据在 `dw_datacenter_precinct` 中，项目与组织的关联字段主要有：

* `orgID`
* `organizationId`

建议 AI 第一版优先按以下方式理解：

* `dw_datacenter_precinct.precinctID` = 项目主键
* `dw_datacenter_precinct.orgID` 或 `organizationId` = 项目所属组织
* 该组织节点在组织表中应对应 `organizationNature = 'propertyProject'`

---

# 4. 项目 / 小区主数据说明

## 4.1 主表

项目主数据表：

`dw_datacenter_precinct`

## 4.2 关键字段

### 主键与组织关联

* `precinctID`：项目主键 ID
* `precinctNo`：项目编码
* `orgID`：组织 ID
* `organizationId`：组织 ID（补充组织映射）
* `enterpriseId`：企业 ID

### 名称字段

* `precinctName`：项目名称
* `areaName`：项目所在区域名称

### 项目属性字段

* `precinctType`：项目类型
* `precinctTypeName`：项目类型名称
* `deliveryTime`：交付时间
* `contractArea`：合同面积
* `nozzleArea`：接管面积
* `payChargeArea`：计费面积
* `totalHouseHolder`：总户数

### 状态字段

* `isDelete`
* `deleteFlag`

---

# 5. 房产与业主说明

## 5.1 业主表

业主房产关系表：

`dw_datacenter_owner`

### 关键字段

* `ownerID`：客户 ID
* `ownerName`：客户名称
* `ownerType`：客户性质

  * `0` 业主
  * `1` 租户
  * `2` 住户
  * `3` 开发商
* `isCurrent`：是否当前客户
* `houseID`：房产 ID
* `houseName`：房产全称
* `precinctID`：项目 ID
* `precinctName`：项目名称
* `orgID`：组织 ID

建议第一版建模时：

* 默认只取 `isCurrent = 1`
* 主体客户优先使用 `ownerType = 0` 业主
* 若涉及租户/住户分析，再扩展其他客户类型

---

## 5.2 房产表

你已提供房产字段结构，但**当前未给出正式表名**。
因此 AI 在代码规划阶段可先按 “House 实体” 建模，但真正落 SQL 前必须补齐正式表名。

### 当前已知的关键字段

* `houseID`：房产 ID
* `houseName`：房产名称
* `precinctID`：项目 ID
* `precinctName`：项目名称
* `buildingID`：楼栋 ID
* `unitID`：单元 ID
* `roomType` / `roomTypeName`：房间业态
* `houseType`：房产类型
* `chargeArea`：计费面积
* `buildArea`：建筑面积
* `stage`：房态状态
* `rentStage`：出租状态
* `decorateStage`：装修状态
* `orgID`：组织 ID

---

# 6. 收费数据说明

收费相关当前由三张核心表构成：

1. **应收表**：`dw_datacenter_charge`
2. **缴款表（实收）**：`dw_datacenter_bill`
3. **收费项目字典表**：`dw_datacenter_chargeitem`

---

## 6.1 收费项目表

### 表名

`dw_datacenter_chargeitem`

### 关键字段

* `chargeItemID`：收费项目 ID
* `chargeItemCode`：收费项目编码
* `chargeItemName`：收费项目名称
* `chargeItemType`：费用类型编码
* `chargeItemTypeName`：费用类型名称
* `chargeItemClass`：费用类别
* `chargeItemClassName`：费用类别名称
* `oneLevelChargeItemName`：一级或二级科目名称
* `organizationID`：组织 ID

### 建模说明

AI 侧建议统一将收费项目实体命名为：

* `ChargeItem`

主键以 `chargeItemID` 为准，名称展示优先使用 `chargeItemName`。

---

## 6.2 应收表

### 表名

`dw_datacenter_charge`

### 核心字段

#### 维度关联字段

* `organizationID`：组织 ID
* `precinctID`：项目 ID
* `precinctName`：项目名称
* `houseID`：房产 ID
* `houseName`：房产名称
* `ownerID`：客户 ID
* `ownerName`：客户名称
* `chargeItemID`：收费项目 ID
* `chargeItemCode`：收费项目编码
* `chargeItemName`：收费项目名称

#### 金额核心字段

* `chargeSum`：应收本金
* `actualChargeSum`：实际应收金额
* `paidChargeSum`：已缴金额
* `arrears`：欠费金额
* `discount`：减免金额
* `delaySum`：违约金
* `delayDiscount`：违约金减免金额

#### 时间字段

* `shouldChargeDate`：应收日期
* `calcStartDate`：计费开始日期
* `calcEndDate`：计费结束日期
* `discountDate`：减免日期
* `createDate`
* `updateDate`

#### 状态字段

* `isCheck`：是否审核
* `isDelete`：是否删除
* `isFreezed`：是否冻结

### 建模说明

对于 AI 来说：

* **应收主题** 以 `dw_datacenter_charge` 为准
* **欠费主题** 直接使用 `arrears`
* 如果要做收缴率分析，应收分母优先基于 `chargeSum` 或业务确认后的应收口径

---

## 6.3 实收表

### 表名

`dw_datacenter_bill`

### 核心字段

#### 维度关联字段

* `organizationID`
* `precinctID`
* `precinctName`
* `houseID`
* `houseName`
* `ownerID`
* `ownerName`
* `chargeItemID`
* `chargeItemCode`
* `chargeItemName`
* `chargeDetailID`

#### 金额核心字段

* `chargePaid`：缴款金额
* `discount`：缴款时减免金额
* `delaySum`：违约金缴款金额

#### 时间字段

* `operatorDate`：缴款日期
* `calcStartDate`
* `calcEndDate`

#### 状态字段

* `isEnterAccount`：是否入账
* `isCanceled`：是否冲销
* `dataType`：数据类型（0缴款 1预收 2合同）
* `refundStatus`：退款状态
* `isAccount`：挂账状态
* `isDelete`：是否删除

### 建模说明

对于 AI 来说：

* **实收主题** 以 `chargePaid` 为核心金额字段
* 默认分析口径建议保留可配置过滤条件：

  * 是否排除冲销
  * 是否排除预收
  * 是否排除退款
  * 是否排除挂账

---

# 7. 工单数据说明

## 7.1 主表

工单明细表：

`dw_datacenter_services`

## 7.2 核心字段

### 主键及关联字段

* `servicesNo`：工单编号
* `organizationId`：组织 ID
* `precinctID`：项目 ID
* `precinctName`：项目名称
* `houseID`：房产 ID
* `customerID`：客户 ID
* `customerName`：客户名称

### 工单分类字段

* `serviceTypeId`
* `serviceTypeName`
* `serviceStyleId`
* `serviceStyleName`
* `oneTypeName`
* `secondTypeName`
* `threeTypeName`
* `serviceKindId`
* `serviceKindIdName`
* `serviceSourceId`
* `serviceSourceName`

### 工单状态字段

* `serviceStatus`
* `serviceStatusName`
* `isCompleted`
* `isOverTime`
* `acceptOverTime`
* `isReprocess`
* `isReturnVisit`
* `isDelete`

### 时间字段

* `createDateTime`
* `updateDateTime`
* `dispatchingDate`
* `acceptDate`
* `arriveDate`
* `receptionDate`
* `accomplishDate`
* `syncDate`

### 内容与人员字段

* `content`：工单描述
* `createUserName`
* `dispatchingUserName`
* `acceptUserName`
* `accomplishUserName`

---

# 8. 投诉数据说明

## 8.1 当前口径

当前**没有独立投诉表**。
投诉主题直接复用：

`dw_datacenter_services`

## 8.2 投诉判定方式

投诉、建议、咨询、报修、通用、表扬等类型，统一从：

* `serviceStyleName`

进行区分。

### 当前业务语义

`serviceStyleName` 可包含：

* 投诉
* 建议
* 咨询
* 报修
* 通用
* 表扬
* 其他扩展类型

## 8.3 AI 建模建议

因此 AI 第一版不要单独创建物理投诉表，而应：

* 将 `Complaint` 建模为 `ServiceOrder` 的业务子类 / 业务视图
* 过滤条件使用：

  * `serviceStyleName = '投诉'`

如需要建议主题、咨询主题，也可按相同方式从工单表中切分。

---

# 9. 满意度数据说明

## 9.1 当前口径

当前**没有独立满意度问卷表**。
满意度直接复用工单表中的满意度字段。

表：

`dw_datacenter_services`

## 9.2 核心字段

* `satisfaction`：满意度（五分制，业务分析优先使用）
* `satisfactionEval`：客户满意度枚举值

  * `0` 未评价
  * `1` 很不满意
  * `2` 不满意
  * `3` 一般
  * `4` 满意
  * `5` 很满意

## 9.3 当前分析建议

第一版 AI 规划时：

* **满意度评分主题** 优先使用 `satisfaction`
* `satisfactionEval` 用于离散化分组与统计
* 满意度当前语义为 **工单满意度 / 服务满意度**
* 不应误认为是全量客户满意度问卷体系

---

# 10. 用户与权限关联说明

## 10.1 用户主表

用户表：

`dw_datacenter_system_user`

## 10.2 核心字段

* `sourceId`：用户 ID
* `enterpriseId`：企业 ID
* `organizationId`：所属组织 ID
* `groupId`：所属集团 ID
* `companyId`：所属公司 ID
* `departmentId`：所属部门 ID
* `sentryId`：岗位 ID
* `sentryName`：岗位名称
* `userAccount`：用户账号
* `password`：用户密码
* `userTelephone`：手机号
* `userPassword`：用户密码（加密）

---

## 10.3 当前权限关联链路

### 用户到组织

用户与组织通过以下字段直接关联：

* `dw_datacenter_system_user.organizationId`
* 对应 `dw_datacenter_system_organization.sourceId`

这是当前最明确的用户-组织挂接关系。

---

### 组织到上下级组织

组织上下级关系通过以下两类字段实现：

1. **直接父子关系**

   * `organizationParentId`

2. **完整祖先链路**

   * `organizationPath`

其中：

* `organizationParentId` 用于单层组织树关系
* `organizationPath` 用于权限继承、范围扩展、祖先链判断

---

### 项目到组织

项目与组织通过项目表关联：

* `dw_datacenter_precinct.orgID`
* `dw_datacenter_precinct.organizationId`

项目所对应的组织节点，本质上就是：

* `organizationNature = 'propertyProject'`

也就是说：

* 用户先挂组织
* 组织通过 path 形成上下级范围
* 项目再通过项目组织字段落到对应组织节点
* 由此实现用户 → 组织 → 项目 → 数据范围的权限裁剪

---

## 10.4 AI 侧应如何理解权限

当前权限模型可按以下逻辑理解：

### 第一步：确定用户所在组织

通过：

* `dw_datacenter_system_user.organizationId`

找到用户所属组织节点。

### 第二步：确定组织权限范围

通过：

* `dw_datacenter_system_organization.organizationPath`
* `organizationParentId`

向上/向下判断组织层级关系。

### 第三步：将项目映射到组织节点

通过：

* `dw_datacenter_precinct.orgID`
* 或 `organizationId`

关联项目所属组织。

### 第四步：将业务事实表裁剪到项目或组织

各业务事实表中的组织 / 项目字段：

* 收费：`organizationID`、`precinctID`
* 工单：`organizationId`、`precinctID`
* 业主：`orgID`、`precinctID`

因此当前可以实现：

* 组织级权限
* 项目级权限
* 组织路径继承权限

---

# 11. AI 第一版应优先建模的实体关系

建议 AI 按如下关系理解：

## 11.1 组织关系

* Organization -> Organization（父子关系）
* Organization -> Project

## 11.2 项目关系

* Project -> House
* Project -> Owner
* Project -> Receivable
* Project -> Payment
* Project -> ServiceOrder

## 11.3 房产与客户关系

* House -> Owner
* House -> Receivable
* House -> Payment
* House -> ServiceOrder

## 11.4 收费关系

* ChargeItem -> Receivable
* ChargeItem -> Payment
* Receivable -> Payment（可通过 `chargeDetailID` 对齐）

## 11.5 工单扩展关系

* ServiceOrder -> Complaint（当 `serviceStyleName = 投诉`）
* ServiceOrder -> Satisfaction

## 11.6 权限关系

* User -> Organization
* Organization -> descendant Organizations（通过 path）
* Organization(propertyProject) -> Project
* User -> accessible Projects

---

# 12. 推荐 AI 先落地的业务场景

基于当前数据，建议 AI 第一轮只做以下场景，不要过度扩展：

## 12.1 收费场景

* 收费项目分布分析
* 应收 / 实收 / 欠费分析
* 项目收缴率分析
* 项目欠费排名
* 项目收费结构分析

## 12.2 工单场景

* 工单量趋势分析
* 工单状态分析
* 工单分类分析
* 工单处理时效分析
* 超时工单分析
* 重处理 / 回访分析

## 12.3 投诉场景

* 投诉工单量趋势
* 投诉类型分析
* 投诉项目分布
* 投诉闭环时效分析

## 12.4 满意度场景

* 工单满意度平均分
* 满意度分布
* 低满意工单识别
* 投诉与满意度关联分析

## 12.5 组织权限场景

* 按用户所在组织过滤数据
* 支持集团 / 区域 / 城市 / 片区 / 项目层级下钻
* 基于 organizationPath 做权限范围裁剪

---

# 13. 当前仍需注意的点

虽然现在信息已经足够开工，但 AI 在代码计划阶段仍需注意以下事项：

## 13.1 房产表正式表名仍缺失

房产字段结构已给出，但正式表名尚未明确。
因此：

* 可以先建 House 实体
* 真正落 SQL 前必须补正式表名

## 13.2 收费口径 给你一个真实的业务统计案例：

[./pre_statistics_company.sql](./pre_statistics_company.sql)

## 13.3 customerID 与 ownerID 不一定天然一一对应

工单表使用：

* `customerID`

收费 / 业主表使用：

* `ownerID`

因此 AI 不应直接假设二者完全相同。
如需做工单与收费强关联，后续要补充客户映射规则。

---

# 14. 给 AI 的最终开发要求建议

当前阶段请 AI 仅基于本文档进行第一轮架构与代码规划，重点输出：

1. Ontology 第一版实体与关系定义
2. 收费 / 工单 / 投诉 / 满意度 / 组织权限的主题模型
3. 关键 SQL 草案
4. Repository / DTO / Service / Skill 的初版拆分
5. Workflow MVP 的节点编排建议
6. 权限裁剪逻辑设计
7. 不要假设存在未给出的独立投诉表、满意度表、角色权限表
8. 不要将旧注释口径覆盖当前业务补充口径


# 15. 完整的原始业务表结构信息

1. 参考 [table.md](./table.md)
2. 注意：pg 这边还没有建相关的表，只是提供了原始业务表 MYSQL 的结构信息