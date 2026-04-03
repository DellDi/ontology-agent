
---

# 数据中心表结构文档

## 1. 组织信息表 (`dw_datacenter_system_organization`)
**描述：** 组织表-数据中心表

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| sourceId | bigint | NOT NULL | 组织ID |
| enterpriseId | bigint | NOT NULL DEFAULT '0' | 所属企业ID |
| groupId | bigint | NOT NULL DEFAULT '0' | 所属集团ID |
| companyId | bigint | NOT NULL DEFAULT '0' | 所属公司ID |
| departmentId | bigint | NOT NULL DEFAULT '0' | 所属部门ID |
| organizationParentId | bigint | NOT NULL DEFAULT '0' | 父级组织ID |
| organizationName | varchar(200) | NOT NULL DEFAULT '' | 组织名称 |
| organizationShortName | varchar(255) | DEFAULT NULL | 组织简称 |
| organizationCode | varchar(150) | NOT NULL DEFAULT '' | 组织编码 |
| organizationType | tinyint | NOT NULL DEFAULT '1' | 组织类型：0集团、1公司、2部门 |
| organizationEnableState | tinyint | NOT NULL DEFAULT '2' | 启用状态：1未启用、2已启用、3已停用 |
| organizationPath | varchar(400) | DEFAULT NULL | 组织路径 |
| organizationLevel | int | NOT NULL DEFAULT '0' | 层级 |
| organizationOrderColumn | int | DEFAULT '0' | 排序 |
| isDeleted | tinyint | NOT NULL DEFAULT '0' | 是否删除：1=已删，0=未删 |
| remark | varchar(500) | NOT NULL DEFAULT '' | 备注 |
| versionId | bigint | NOT NULL DEFAULT '0' | 版本主键 |
| createUserId | bigint | NOT NULL DEFAULT '0' | 创建用户ID |
| createUserName | varchar(40) | NOT NULL DEFAULT '' | 创建用户名称 |
| createTime | timestamp | NOT NULL DEFAULT CURRENT_TIMESTAMP | 创建时间 |
| updateUserId | bigint | NOT NULL DEFAULT '0' | 更新用户ID |
| updateUserName | varchar(40) | NOT NULL DEFAULT '' | 更新用户名称 |
| updateTime | timestamp | NOT NULL DEFAULT CURRENT_TIMESTAMP | 更新时间 |
| syncDepartmentId | varchar(16) | DEFAULT NULL | 同步V8部门id |
| syncOrganizationId | varchar(50) | DEFAULT NULL | 永升组织id |
| syncOrganizationParentId| varchar(50) | DEFAULT NULL | 永升父级组织id |
| syncStatus | tinyint(1) | DEFAULT NULL | 同步状态：0更新，1插入 |
| organizationDimension | varchar(50) | DEFAULT NULL | 组织维度（CRM:adm，金蝶:fin） |
| organizationDimensionAliasName | varchar(255) | DEFAULT NULL | 组织维度别名 |
| organizationScope | varchar(50) | DEFAULT NULL | 范围：E1内部/E2编外/O1外部/F1公共/P1项目 |
| organizationManagerId | varchar(32) | DEFAULT NULL | 部门负责人id |
| organizationPartManagerId| varchar(32) | DEFAULT NULL | 部门分管领导id |
| organizationHrTypeCode | varchar(50) | DEFAULT NULL | 组织单元类型编码 |
| organizationHierarchicalClassCode | varchar(50)| DEFAULT NULL | 层级分类编码 |
| organizationStageCode | varchar(50) | DEFAULT NULL | 层级类型编码 |
| organizationStageLevelCode| varchar(100)| DEFAULT NULL | 层级级别编码 |
| organizationSource | varchar(100) | DEFAULT NULL | 版块标识 |
| organizationNature | varchar(255) | DEFAULT NULL | 组织性质：controllingCompany集团/cityDevision城市分公司/areaDivision区域公司/district片区/propertyProject项目... |
| dataAnalysisType | varchar(200) | DEFAULT NULL | 数据分析类型 |
| sys_date | date | DEFAULT NULL | 系统日期 |

> **💡 补充说明：**
> * **权限关联**：组织权限挂钩 `organizationPath`（组织路径）。
> * **组织性质**：`organizationNature` 对应图一中的字典值对照。
> * **路径格式**：`organizationPath` 采用如 `/240/2853/2858/` 的格式，代表父子关系链路。

---

## 2. 项目信息表 (`dw_datacenter_precinct`)
**描述：** 项目主数据表

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| enterpriseId | varchar(100) | NULL | 企业ID |
| dataSource | varchar(100) | NULL | 数据来源:V8/V10/第3方系统名称 |
| orgID | varchar(100) | NULL | 组织ID |
| areaID | varchar(100) | NULL | 项目所在区域ID |
| areaName | varchar(100) | NULL | 项目所在区域 |
| precinctID | varchar(100) | NULL | 项目主键ID |
| precinctNo | varchar(100) | NULL | 项目编码 |
| precinctName | varchar(100) | NULL | 项目名称 |
| deliveryTime | datetime | NULL | 交付日期 |
| provinceId | varchar(15) | NULL | 省份id |
| cityId | varchar(15) | NULL | 城市id |
| areaCityId | varchar(15) | NULL | 区域id |
| streetId | varchar(15) | NULL | 街道id |
| proNature | varchar(100) | NULL | 项目性质：1.自管 2.代管 |
| checkMerger | varchar(20) | NULL | 是否收并购，1是，0否 |
| checkOldPrecinct | varchar(20) | NULL | 是否老旧项目，1是，0否 |
| oldTaxRate | decimal(3, 2) | NULL | 老旧项目税率 |
| precinctType | varchar(100) | NULL | 项目类型 |
| precinctTypeName | varchar(100) | NULL | 项目类型名称 |
| isDelete | int | NULL | 是否已删除 0:未删除 1:已删除 |
| createDate | datetime | NULL | 创建时间 |
| updateDate | datetime | NULL | 更新时间 |
| syncDate | datetime | NULL | 同步时间 (默认取当前时间) |
| contractArea | decimal(18, 2)| DEFAULT 0.00 | 合同面积 |
| nozzleArea | decimal(18, 2)| DEFAULT 0.00 | 接管面积 |
| payChargeArea | decimal(18, 2)| DEFAULT 0.00 | 计费面积 |
| precinctArea | varchar(100) | NULL | 项目面积 |
| totalHouseHolder | int | DEFAULT 0 | 总户数 |
| parkingAmount | int | DEFAULT 0 | 车位数 |
| organizationId | bigint | DEFAULT 0 | 组织id |
| deleteFlag | int | DEFAULT 0 | 删除状态 |
| createUserId | bigint | NULL | 创建人id |
| createUserName | varchar(200) | NULL | 创建人姓名 |
| createDateTime | date | NULL | 创建时间 |
| updateUserId | bigint | NULL | 修改人id |
| updateUserName | varchar(200) | NULL | 修改人姓名 |
| updateDateTime | date | NULL | 修改时间 |

> **💡 补充说明：**
> * 图片上项目类型的组织性质，可以关联一个唯一的项目。

---

## 3. 业主房产信息表 (`dw_datacenter_owner`)
**描述：** 房产客户数据关联表

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| enterpriseId | varchar(100) | NULL | 企业ID |
| dataSource | varchar(100) | NULL | 数据来源:V8/V10/第3方系统名称 |
| orgID | varchar(100) | NULL | 组织ID |
| precinctID | varchar(100) | NULL | 项目主键ID |
| precinctName | varchar(100) | NULL | 项目名称 |
| houseID | varchar(200) | NULL | 房产ID |
| houseName | varchar(200) | NULL | 房产全称 |
| ownerID | varchar(100) | NULL | 客户ID |
| ownerName | varchar(100) | NULL | 客户名称 |
| ownerType | varchar(100) | NULL | 客户性质：0业主 1租户 2住户 3开发商 |
| isCurrent | varchar(100) | NULL | 是否当前客户 0:历史 1:当前 |
| isDelete | int | NULL | 是否已删除 0:未删除 1:已删除 |
| createDate | datetime | NULL | 创建时间 |
| updateDate | datetime | NULL | 更新时间 |
| syncDate | datetime | NULL | 同步时间 (默认取当前时间) |

---

## 4. 房产信息表
**描述：** 记录房产、楼栋及单元等实体信息表

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| enterpriseId | varchar(100) | NULL | 企业ID |
| dataSource | varchar(100) | NULL | 数据来源:V8/V10/第3方系统名称 |
| orgID | varchar(100) | NULL | 组织ID |
| precinctID | varchar(100) | NULL | 项目主键ID |
| precinctName | varchar(100) | NULL | 项目名称 |
| houseID | varchar(200) | NULL | 房产ID |
| houseName | varchar(200) | NULL | 房产全称 |
| roomType | varchar(200) | NULL | 房间业态：会所、洋房、地下储藏室等 |
| roomTypeName | varchar(200) | NULL | 房间业态名称 |
| houseType | varchar(200) | NULL | 房产类型：0初始 1区域 2项目 3组团 4楼栋...8车位 9公区 |
| chargeArea | decimal(18, 4)| NULL | 计费面积 |
| buildArea | decimal(18, 4)| NULL | 建筑面积 |
| isShow | int | NULL | 是否展示 0:展示 1:不展示(关闭服务后) |
| isSpilt | int | NULL | 是否被拆分 1:是 0:否 |
| isVirtual | int | NULL | 是否虚拟 0:否 1:是 |
| stage | varchar(25) | NULL | 房态当前状态：10空置 20未领 30空关 40入住 |
| buildingID | varchar(100) | NULL | 楼栋/车库ID |
| regionalCompanyId | varchar(100) | NULL | 区域公司id |
| areaID | varchar(100) | NULL | 区域ID |
| clusterID | varchar(100) | NULL | 管理区域ID |
| businessClusterID | varchar(100) | NULL | 业态组团ID |
| unitID | varchar(100) | NULL | 单元/车区ID |
| isDelete | int | NULL | 是否已删除 0:未删除 1:已删除 |
| createDate | datetime | NULL | 创建时间 |
| updateDate | datetime | NULL | 更新时间 |
| syncDate | datetime | NULL | 同步时间 (默认取当前时间) |
| rentStage | varchar(25) | NULL | 出租状态 0未出租 1已出租 |
| decorateStage | varchar(25) | NULL | 装修状态 0未装修 1装修中 2已装修 |
| rentStatus | varchar(25) | NULL | 租赁状态：已租 待租 预约 不可租 |
| ownerProperty | varchar(25) | NULL | 客户性质：0业主 1租户 2住户 3开发商 |
| isBlockUp | int | DEFAULT 0 | 是否停用 0:否 1:是 |

---

## 5. 财务缴款明细表 (`dw_datacenter_bill`)
**描述：** 记录各项财务缴款和流水台账信息

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| DBID | int | DEFAULT 0 | 分库ID |
| enterpriseId | varchar(100) | NULL | 企业ID |
| organizationID | varchar(100) | NULL | 组织ID |
| dataSource | varchar(100) | NULL | 数据来源 雪松/银湾 |
| chargePaymentID | varchar(100) | NULL | 缴款表主键ID |
| chargeDetailID | varchar(100) | NULL | 应收款表主键ID |
| precinctID | varchar(100) | NULL | 项目主键ID |
| precinctName | varchar(100) | NULL | 项目名称 |
| houseID | varchar(200) | NULL | 房产ID |
| houseName | varchar(200) | NULL | 房产全称 |
| roomType | varchar(200) | NULL | 房间业态 |
| ownerID | varchar(100) | NULL | 客户ID |
| ownerName | varchar(100) | NULL | 客户名称 |
| chargeItemID | varchar(100) | NULL | 费用科目ID |
| chargeItemCode | varchar(100) | NULL | 费用科目编码 |
| chargeItemName | varchar(100) | NULL | 费用科目名称 |
| calcStartDate | datetime | NULL | 计费开始日期 |
| calcEndDate | datetime | NULL | 计费结束日期 |
| calcEndYear | int | NULL | 计费结束日期所在年 |
| shouldAccountBook| int | NULL | 应收账期 |
| accountBook | int | NULL | 账期 |
| actualAccountBook| int | NULL | 实收账期/会计账期 |
| chargePaid | decimal(18, 2)| NULL | 缴款金额 |
| discount | decimal(18, 2)| NULL | 缴款时的减免金额 |
| delaySum | decimal(18, 2)| NULL | 违约金缴款金额 |
| operatorDate | datetime | NULL | 缴款日期 |
| paidYear | int | NULL | 缴款日期所在年 |
| paidMonth | int | NULL | 缴款日期所在月 |
| paidDay | int | NULL | 缴款日期所在日 |
| isEnterAccount | varchar(10) | NULL | 是否已入账 0:未入账 1:已入账 |
| chargeArea | decimal(18, 4)| NULL | 房间计费面积 |
| subjectCode | varchar(100) | NULL | 业务标志 |
| sourceIncome | varchar(100) | NULL | 收费来源 |
| squareTypeID | varchar(100) | NULL | 结算方式 |
| squareTypeName | varchar(100) | NULL | 结算方式名称 |
| isCanceled | varchar(100) | NULL | 是否冲销 0:未冲销 1:已冲销 |
| isDelete | int | NULL | 是否已被删除 |
| dataType | int | NULL | 0:缴款 1:预收 2:合同 |
| precinct_collection_type | int | DEFAULT 0 | 代收类型: 0无 1代收其他项目 2其他项目代收 |
| refundStatus | varchar(16) | NULL | 退款状态 |
| updateDate | datetime | NULL | 更新时间 |
| syncDate | datetime | NULL | 同步时间 (默认取当前时间) |
| isAccount | int | NULL | 挂账状态 0无 1挂账 2已销账 3销账 |

---

## 6. 财务应收明细表 (`dw_datacenter_charge`)
**描述：** 记录财务应收款明细

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| DBID | int | DEFAULT 0 | 分库ID |
| enterpriseId | varchar(100) | NULL | 企业ID |
| organizationID | varchar(100) | NULL | 组织ID |
| dataSource | varchar(100) | NULL | 数据来源 雪松/银湾 |
| chargeDetailID | varchar(100) | NULL | 应收款表主键ID |
| precinctID | varchar(100) | NULL | 项目主键ID |
| precinctName | varchar(100) | NULL | 项目名称 |
| houseID | varchar(200) | NULL | 房产ID |
| houseName | varchar(200) | NULL | 房产全称 |
| roomType | varchar(200) | NULL | 房间业态 |
| chargeArea | decimal(18, 4)| NULL | 房间计费面积 |
| ownerID | varchar(100) | NULL | 客户ID |
| ownerName | varchar(100) | NULL | 客户名称 |
| chargeItemID | varchar(100) | NULL | 费用科目ID |
| chargeItemCode | varchar(100) | NULL | 费用科目编码 |
| chargeItemName | varchar(100) | NULL | 费用科目名称 |
| shouldAccountBook| int | NULL | 应收账期 |
| shouldChargeDate | datetime | NULL | 应收日期 |
| calcStartDate | datetime | NULL | 计费开始日期 |
| calcEndDate | datetime | NULL | 计费结束日期 |
| calcEndYear | int | NULL | 计费结束日期所在年 |
| amount | decimal(18, 4)| NULL | 计算面积 |
| actualChargeSum| decimal(18, 2)| NULL | 实际应收金额 |
| chargeSum | decimal(18, 2)| NULL | 应收本金 |
| discount | decimal(18, 2)| NULL | 减免金额 |
| delaySum | decimal(18, 2)| NULL | 违约金 |
| delayDiscount | decimal(18, 2)| NULL | 违约金减免金额 |
| paidChargeSum | decimal(18, 2)| NULL | 已缴金额 |
| arrears | decimal(18, 2)| NULL | 欠费金额 |
| isCheck | varchar(100) | NULL | 是否审核 0:未审核 1:已审核 |
| isEstate | tinyint | NULL | 地产标识 1:内部地产 0:非内部地产 |
| isDelete | int | NULL | 是否已删除 0:未删除 1:已删除 |
| createDate | datetime | NULL | 创建时间 |
| updateDate | datetime | NULL | 更新时间 |
| syncDate | datetime | NULL | 同步时间 (默认取当前时间) |
| isFreezed | tinyint | NULL | 是否被冻结 1:是 2否 |
| discountDate | datetime | NULL | 减免日期 |

---

## 7. 收费科目对照表 (`dw_datacenter_chargeitem`)
**描述：** 费用科目及其分组、类别的对照表

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| enterpriseId | varchar(100) | NULL | 企业ID |
| organizationID | varchar(100) | NULL | 组织ID |
| dataSource | varchar(100) | NULL | 数据来源:V8/V10/第3方系统名称 |
| chargeItemID | varchar(100) | NULL | 费用科目ID |
| chargeItemCode | varchar(100) | NULL | 费用科目编码 |
| chargeItemName | varchar(100) | NULL | 费用科目名称 |
| chargeItemType | varchar(100) | NULL | 费用类型名称编码 |
| chargeItemTypeName | varchar(100) | NULL | 费用类型名称 |
| taxRate | decimal(3, 2) | NULL | 税率 |
| itemGroupId | bigint | NULL | 科目分组Id，dim_chargeItemGroup.id |
| itemDetailGroupId| bigint | NULL | 考核明细分组Id |
| cashFlowGroupId| bigint | NULL | 现金流分组 |
| chargeItemClass| int | NULL | 费用类别 |
| chargeItemClassName| varchar(100) | NULL | 费用类别名称 |
| path | varchar(200) | NULL | 路径 |
| createDate | datetime | NULL | 创建时间 |
| updateDate | datetime | NULL | 更新时间 |
| syncDate | datetime | NULL | 同步时间 (默认取当前时间) |
| deleteFlag | int | DEFAULT 0 | 删除状态 |
| createUserId | bigint | NULL | 创建人id |
| createUserName | varchar(200) | NULL | 创建人姓名 |
| createDateTime | date | NULL | 创建时间 |
| updateUserId | bigint | NULL | 修改人id |
| updateUserName | varchar(200) | NULL | 修改人姓名 |
| updateDateTime | date | NULL | 修改时间 |
| chargeItemOutType| varchar(100) | NULL | 科目类别字段 |
| oneLevelChargeItemName | varchar(100) | NULL | 动态换算 一级或者二级科目名称 |

---

## 8. 工单明细表 (`dw_datacenter_services`)
**描述：** 记录客户服务工单详情信息

| 字段名 | 数据类型 | 约束 / 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| id | bigint | AUTO_INCREMENT PRIMARY KEY | 主键 |
| enterpriseId | varchar(100) | NULL | 企业ID |
| organizationId | varchar(100) | NULL | 组织ID |
| dataSource | varchar(100) | NULL | 数据来源 雪松/银湾 |
| precinctID | varchar(100) | NULL | 项目主键ID |
| precinctName | varchar(100) | NULL | 项目名称 |
| houseID | varchar(200) | NULL | 房产ID |
| customerID | int | DEFAULT 0 | 客户ID |
| customerHouseID| int | DEFAULT 0 | 客户房号ID |
| customerHouseName| varchar(100) | NULL | 客户房号名称 |
| customerName | varchar(100) | NULL | 客户名称 |
| houseName | varchar(200) | NULL | 房产全称 |
| servicesNo | varchar(100) | NULL | 工单编号 |
| content | varchar(1000) | NULL | 工单描述 |
| createUserName | varchar(100) | NULL | 创建人 |
| createDateTime | datetime | NULL | 创建时间 |
| updateDateTime | datetime | NULL | 更新时间 |
| isDelete | int | NULL | 是否删除 |
| createYear | int | NULL | 创建所在年 |
| createMonth | int | NULL | 创建所在月 |
| dispatchingUserName| varchar(100) | NULL | 分派人 |
| dispatchingDate| datetime | NULL | 分派时间 |
| acceptUserName | varchar(100) | NULL | 接单人 |
| acceptDate | datetime | NULL | 接单时间 |
| arriveDate | datetime | NULL | 到达时间 |
| receptionDate | datetime | NULL | 受理时间（登记时间） |
| accomplishUserName | varchar(100) | NULL | 完成处理人 |
| accomplishDate | datetime | NULL | 完成处理时间 |
| serviceStatus | varchar(100) | NULL | 工单状态 |
| serviceStatusName| varchar(100) | NULL | 工单状态名称 |
| serviceTypeId | varchar(100) | NULL | 工单分类ID |
| serviceTypeName| varchar(100) | NULL | 工单分类名称 |
| serviceSourceId| varchar(100) | NULL | 工单来源ID |
| serviceSourceName| varchar(100) | NULL | 工单来源名称 |
| serviceStyleId | varchar(100) | NULL | 工单类型ID |
| serviceStyleName | varchar(100) | NULL | 工单类型名称 |
| isCompleted | varchar(10) | NULL | 是否完成 |
| isOverTime | varchar(10) | NULL | 是否处理及时（或超时） |
| isReprocess | varchar(10) | NULL | 是否重处理 |
| isReturnVisit | varchar(10) | NULL | 是否回访 |
| satisfaction | int | NULL | 满意度 |
| syncDate | datetime | NULL | 同步时间 |
| acceptOverTime | int | DEFAULT 0 | 完成是否超时 0否 1是 |
| satisfactionEval | int | DEFAULT 0 | 客户满意度: 0未评价 1很不满意 2不满意 3一般 4满意 5很满意 |
| servicePayTypeId | int | DEFAULT 0 | 服务类型 0无偿 1有偿 2不确定 |
| oneTypeName | varchar(100) | DEFAULT '' | 一级工单分类名称 |
| secondTypeName | varchar(100) | NULL | 二级工单分类名称 |
| threeTypeName | varchar(100) | NULL | 三级工单分类名称 |
| serviceKindId | varchar(100) | DEFAULT '' | 受理类型ID |
| serviceKindIdName| varchar(100) | DEFAULT '' | 受理类型ID的字典名称 |