# 原型动态面板接入

日期：2026-10-31。代码已接入，用户已选择本轮仅完成代码与本地契约验证；真实业务页面验收留待后续新源数据。未发布公司服务，未执行公司迁移或采集。

## 标准源契约

本轮以本机 easyv-ai-java `feat/gc/tabs-panal-v8.23` / `1ad6028b3` 的 `ScreenPlanningExportAssembler`、`PoolPanelApplier` 和测试为依据。

- XML 宿主 `Block` 使用 `render="dynamic-panel"`、JSON 数组格式的 `options`，按顺序引用状态 ID。
- 页面 JSON 的 `blocks` 同时保存宿主与各状态；宿主组件为空，状态保存各自标题、用途、绑定指标与组件。
- 页级 `controls[]` 使用 `moduleName:"tabV2"`、`effect:"panelSwitch"`、`ref:[hostId]`，保留正式控件 ID。不是旧的 `kind:"tabs"`／标量 ref 协议。

## 当前实现

- Java 解析器校验页级控件、XML 宿主、状态集合、唯一性及同页关联。状态转换为宿主下的结构节点，保留原正式 ID；复用区域和组件物化，状态的 `container_id` 为宿主 ID。宿主外框不因状态数重新分割。
- 页面语义保留 `panels`，含控件 ID／moduleName／effect／ref 和状态顺序；原型详情和模型的页面语义呈现均读入该信息。每个状态仍可通过现有对象查询读取用途、指标和单位口径。
- 分析工作区和独立目录复用同一画布。页签展示源状态标题，默认首项；切换后只展示该状态组件并同步正式对象选区，核心指标及普通非面板模块保持原流程。放大视图共用同一切换状态。
- 新增 V34，只更新后续物化的产品定义版本：layout-v5／block-v6／component-v4。复用现有 JSONB 和区域字段，没有新增表或并行查询接口。旧冻结事实不回填。

## 验证

- Java 34 项通过：解析 18、PostgreSQL Testcontainers 物化 16。面板专项验证：宿主与两状态共三条区域、两条组件、状态父引用、tabV2 控件语义及状态顺序落库；缺失、重复状态和缺少控件明确拒绝。
- Web 215 项：210 通过、5 可选跳过；面板投影保留一个外框、两个有序状态，缺失状态显示诊断；SSR 组件验证页签名称、选中态及默认只呈现首状态。
- TypeScript、相关 ESLint、生产构建和 diff 检查通过。日志 `/tmp/panel-{java-final,web-final,build,lint,types}.log`。
- 上述样本是明确的协议测试数据，未作为真实业务快照导入。尚未以新源快照在浏览器验证真实 tabs 切换，不宣称端到端验收完成。

## 后续真实数据验收（本轮不执行）

需沿既有 saas-test 源重新采集并正式发布原型相关产品，保留历史集合，再追加同步至本地。在真实快照中检查：宿主不重复分割、标签顺序和标题、不同状态组件及指标详情不串用、窄屏和放大视图切换。公司发布、迁移、采集和同步均尚未执行。

本轮仅扩展结构读取、语义和展示；不新增面板生成、面板状态源写回或控件编辑能力。现有动作校验不会因前端支持显示而放宽。

提交前补充验证（2026-10-31）：修正 DatabaseMigrationServiceTest 的最终版本及产品定义预期至 V34；相关 Java 7 类共 112 项通过，Web 210 通过／5 可选跳过，完整生产构建与 diff 检查通过。日志 `/tmp/precommit-java.log`、`/tmp/precommit-web.log`、`/tmp/precommit-build.log`。
