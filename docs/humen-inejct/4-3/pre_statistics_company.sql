-- =====================================================
-- 收缴情指标预统计 SQL
-- 说明：按项目汇总，输出收缴情率、年应收、年实收、月实收、日实收
-- 参数：${searchYear} 'YYYY'，${searchYearMonth} 'YYYY-MM'，${searchDay} 'YYYY-MM-DD'
-- 口径：业务标识直接使用 "已缴款,红冲,退款,押金类转,押金类转红冲,临时缴款,预收款结转,预收款结转红冲,退款转预收"
-- =====================================================

-- 业务含义：

--收缴率： 统计的年实收/年应收*100%，整个表格顺序按项目收缴率排名从高到低排序
--年应收 根据统计年份所选年份控制，计费周期为所选年份的第一天到最后一天的应收金额，按项目汇总
--年实收 【全年应收】： 取出的应收数据在筛选条件所选的缴费开始/结束日期这个范围内已收的金额合计，默认从年初到年末的实收金额，按项目汇总，业务标志为常用9大标志，如20251110查询或查询时间选到这天，则该列统计全年应收范围内缴款日期在20250101-20251231期间内的已收合计
--月实收 【全年应收】： 取出的应收数据在筛选条件所选缴费日期当月这个范围内已收的金额合计，默认从查询时的月初到月末的实收金额，按项目汇总，业务标志为常用9大标志，如20251110查询或查询时间选到这天，择该列统计全年应收范围内，缴款日期在20251101-20251130期间内的已收金额合计
--日实收 【全年应收】： 取出的应收数据在筛选条件所选缴费日期当当天范围内已收的金额合计，默认从查询时间当天的实收金额，按项目汇总，业务标志为常用9大标志，如20251110查询或查询时间选到这天，择该列统计全年应收范围内，缴款日期在20251110-20251110期间内的已收金额合计

DROP TEMPORARY TABLE IF EXISTS tmp_company_charge_base;
DROP TEMPORARY TABLE IF EXISTS tmp_company_bill_agg;
DROP TEMPORARY TABLE IF EXISTS tmp_company_project_agg;

-- 1) 年应收基础明细：按所选年份统计全年应收金额
CREATE TEMPORARY TABLE tmp_company_charge_base AS
SELECT
    a.enterpriseID,
    a.organizationID,
    a.precinctID,
    a.chargeDetailID,
    IFNULL(a.actualChargeSum, 0) AS actualChargeSum
FROM dw_datacenter_charge a
INNER JOIN dw_datacenter_chargeitem c
    ON a.chargeItemID = c.chargeItemID
   AND c.chargeItemType = '1'
WHERE a.isDelete = 0
  AND a.isCheck = '审核通过'
  AND a.shouldAccountBook >= CONCAT(${searchYear}, '01')
  AND a.shouldAccountBook <= CONCAT(${searchYear}, '12');

-- 2) 实收预聚合：一次扫描完成年 / 月 / 日三个窗口
CREATE TEMPORARY TABLE tmp_company_bill_agg AS
SELECT
    chargeDetailID,
    SUM(
        CASE
            WHEN isDelete = 0
             AND isEnterAccount = 1
             AND (RefundStatus IS NULL OR RefundStatus != '待退款')
             AND precinct_collection_type != 1
             AND FIND_IN_SET(subjectCode, "已缴款,红冲,退款,押金类转,押金类转红冲,临时缴款,预收款结转,预收款结转红冲,退款转预收")
             AND paidYear = ${searchYear}
            THEN IFNULL(chargePaid, 0)
            ELSE 0
        END
    ) AS year_paid,
    SUM(
        CASE
            WHEN isDelete = 0
             AND isEnterAccount = 1
             AND (RefundStatus IS NULL OR RefundStatus != '待退款')
             AND precinct_collection_type != 1
             AND FIND_IN_SET(subjectCode, "已缴款,红冲,退款,押金类转,押金类转红冲,临时缴款,预收款结转,预收款结转红冲,退款转预收")
             AND paidYear = LEFT(${searchYearMonth}, 4)
             AND paidMonth = RIGHT(${searchYearMonth}, 2)
            THEN IFNULL(chargePaid, 0)
            ELSE 0
        END
    ) AS month_paid,
    SUM(
        CASE
            WHEN isDelete = 0
             AND isEnterAccount = 1
             AND (RefundStatus IS NULL OR RefundStatus != '待退款')
             AND precinct_collection_type != 1
             AND FIND_IN_SET(subjectCode, "已缴款,红冲,退款,押金类转,押金类转红冲,临时缴款,预收款结转,预收款结转红冲,退款转预收")
             AND paidYear = LEFT(${searchDay}, 4)
             AND paidMonth = SUBSTRING(${searchDay}, 6, 2)
             AND paidDay = RIGHT(${searchDay}, 2)
            THEN IFNULL(chargePaid, 0)
            ELSE 0
        END
    ) AS day_paid
FROM dw_datacenter_bill
WHERE paidYear = ${searchYear}
GROUP BY chargeDetailID;

-- 3) 项目级汇总
CREATE TEMPORARY TABLE tmp_company_project_agg AS
SELECT
    a.enterpriseID,
    a.organizationID,
    a.precinctID,
    SUM(a.actualChargeSum) AS year_receivable,
    SUM(IFNULL(b.year_paid, 0)) AS year_paid,
    SUM(IFNULL(b.month_paid, 0)) AS month_paid,
    SUM(IFNULL(b.day_paid, 0)) AS day_paid
FROM tmp_company_charge_base a
LEFT JOIN tmp_company_bill_agg b
    ON a.chargeDetailID = b.chargeDetailID
GROUP BY
    a.enterpriseID,
    a.organizationID,
    a.precinctID;

-- 4) 清理旧数据
DELETE FROM dws_target_charge
WHERE currentDate = ${searchYear}
  AND dateType = 0
  AND layer = 0
  AND targetId IN ('30006', '30007', '30008');

DELETE FROM dws_target_charge
WHERE currentDate = ${searchYearMonth}
  AND dateType = 3
  AND layer = 0
  AND targetId = '30009';

DELETE FROM dws_target_charge
WHERE currentDate = ${searchDay}
  AND dateType = 5
  AND layer = 0
  AND targetId = '30010';

-- 5) 写入年口径指标
INSERT INTO dws_target_charge(
    enterpriseID,
    organizationID,
    precinctID,
    stewardID,
    targetId,
    dateType,
    currentDate,
    numerator,
    denominator,
    targetValue,
    targetItemName,
    layer,
    createDateTime
)
SELECT
    enterpriseID,
    organizationID,
    precinctID,
    NULL AS stewardID,
    '30006' AS targetId,
    0 AS dateType,
    ${searchYear} AS currentDate,
    year_paid AS numerator,
    year_receivable AS denominator,
    CASE
        WHEN year_receivable > 0 THEN ROUND(year_paid / year_receivable * 100, 4)
        ELSE 0
    END AS targetValue,
    '收缴率' AS targetItemName,
    0 AS layer,
    NOW() AS createDateTime
FROM tmp_company_project_agg
WHERE year_receivable > 0;

INSERT INTO dws_target_charge(
    enterpriseID,
    organizationID,
    precinctID,
    stewardID,
    targetId,
    dateType,
    currentDate,
    numerator,
    denominator,
    targetValue,
    targetItemName,
    layer,
    createDateTime
)
SELECT
    enterpriseID,
    organizationID,
    precinctID,
    NULL AS stewardID,
    '30007' AS targetId,
    0 AS dateType,
    ${searchYear} AS currentDate,
    NULL AS numerator,
    NULL AS denominator,
    year_receivable AS targetValue,
    '年应收' AS targetItemName,
    0 AS layer,
    NOW() AS createDateTime
FROM tmp_company_project_agg
WHERE year_receivable <> 0;

INSERT INTO dws_target_charge(
    enterpriseID,
    organizationID,
    precinctID,
    stewardID,
    targetId,
    dateType,
    currentDate,
    numerator,
    denominator,
    targetValue,
    targetItemName,
    layer,
    createDateTime
)
SELECT
    enterpriseID,
    organizationID,
    precinctID,
    NULL AS stewardID,
    '30008' AS targetId,
    0 AS dateType,
    ${searchYear} AS currentDate,
    NULL AS numerator,
    NULL AS denominator,
    year_paid AS targetValue,
    '年实收' AS targetItemName,
    0 AS layer,
    NOW() AS createDateTime
FROM tmp_company_project_agg
WHERE year_paid <> 0;

-- 6) 写入月 / 日口径指标
INSERT INTO dws_target_charge(
    enterpriseID,
    organizationID,
    precinctID,
    stewardID,
    targetId,
    dateType,
    currentDate,
    numerator,
    denominator,
    targetValue,
    targetItemName,
    layer,
    createDateTime
)
SELECT
    enterpriseID,
    organizationID,
    precinctID,
    NULL AS stewardID,
    '30009' AS targetId,
    3 AS dateType,
    ${searchYearMonth} AS currentDate,
    NULL AS numerator,
    NULL AS denominator,
    month_paid AS targetValue,
    '月实收' AS targetItemName,
    0 AS layer,
    NOW() AS createDateTime
FROM tmp_company_project_agg
WHERE month_paid <> 0;

INSERT INTO dws_target_charge(
    enterpriseID,
    organizationID,
    precinctID,
    stewardID,
    targetId,
    dateType,
    currentDate,
    numerator,
    denominator,
    targetValue,
    targetItemName,
    layer,
    createDateTime
)
SELECT
    enterpriseID,
    organizationID,
    precinctID,
    NULL AS stewardID,
    '30010' AS targetId,
    5 AS dateType,
    ${searchDay} AS currentDate,
    NULL AS numerator,
    NULL AS denominator,
    day_paid AS targetValue,
    '日实收' AS targetItemName,
    0 AS layer,
    NOW() AS createDateTime
FROM tmp_company_project_agg
WHERE day_paid <> 0;

DROP TEMPORARY TABLE IF EXISTS tmp_company_project_agg;
DROP TEMPORARY TABLE IF EXISTS tmp_company_bill_agg;
DROP TEMPORARY TABLE IF EXISTS tmp_company_charge_base;
