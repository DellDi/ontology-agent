-- 物业域封存：dip3.property.enabled=false 部署时，domain pack 不装配；
-- 此迁移同步把 ingestion 目录中的 property 源/数据集/产品置为 disabled，
-- 使发布表单与目录如实反映封存状态。幂等 UPDATE，可重复执行；
-- 历史事实数据、冻结版本与血缘记录保留不删。

UPDATE "ingestion"."data_product_definitions"
SET "status" = 'disabled', "updated_at" = now()
WHERE "domain_key" = 'property' AND "status" <> 'disabled';
--> statement-breakpoint

UPDATE "ingestion"."dataset_definitions"
SET "status" = 'disabled', "updated_at" = now()
WHERE "source_key" = 'property' AND "status" <> 'disabled';
--> statement-breakpoint

UPDATE "ingestion"."source_definitions"
SET "status" = 'disabled', "updated_at" = now()
WHERE "source_key" = 'property' AND "status" <> 'disabled';
