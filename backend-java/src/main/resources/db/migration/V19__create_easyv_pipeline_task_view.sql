-- 原型流水线任务：由同一 product version 内的节点记录按 task_id 归并。
-- 归并口径与原 pipeline-task-outcome 查询一致：MAIN 主链 PIPELINECOMPLETED 成功为 completed，
-- MAIN 主链出现 FAILED 为 failed，两者同时出现为 conflict（数据矛盾，需复核），否则 incomplete。
-- 视图只读、随节点事实版本不可变；本体对象 easyv-pipeline-task 与 Cube EasyvPipelineTask 读取本视图。
CREATE OR REPLACE VIEW "facts"."easyv_pipeline_task" AS
SELECT
    t.product_version_id,
    t.task_id,
    CASE
        WHEN t.completed AND t.failed THEN 'conflict'
        WHEN t.completed THEN 'completed'
        WHEN t.failed THEN 'failed'
        ELSE 'incomplete'
    END AS outcome,
    t.node_count,
    t.started_at,
    t.last_node_at
FROM (
    SELECT
        n.product_version_id,
        n.task_id,
        bool_or(upper(n.branch) = 'MAIN' AND upper(n.step_name) = 'PIPELINECOMPLETED'
            AND upper(n.status) = 'SUCCESS') AS completed,
        bool_or(upper(n.branch) = 'MAIN' AND upper(n.status) = 'FAILED') AS failed,
        count(*) AS node_count,
        min(n.created_at) AS started_at,
        max(n.created_at) AS last_node_at
    FROM "facts"."easyv_pipeline_node" n
    GROUP BY n.product_version_id, n.task_id
) t;
