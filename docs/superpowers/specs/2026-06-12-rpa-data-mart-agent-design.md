# RPA Data Mart And Agent Reporting Design

Date: 2026-06-12
Status: Approved for implementation planning
Owner: 点之出众 internal agent workspace

## Summary

选择 B 版：SQLite 控制面 + DuckDB 分析层。

当前项目已经有 SQLite 控制面，负责门店、飞书群、员工、平台账号、浏览器登录态、记忆和审计。RPA/影刀每天产生的经营数据，不管是 CSV/Excel 文件、数据库中转表，还是后续 API 回调，都不应该直接塞进这套控制面表里，而应该先进入一个独立的接入层，再进入本地分析数据集市。

目标形态：

```text
RPA 下载文件 / 影刀数据库中转表 / API 回调
  -> RPA Ingress 接入层
  -> 原始数据留痕
  -> 数据导入批次记录
  -> DuckDB 原始层/明细层/指标层
  -> Agent 查询工具
  -> 飞书日报、预警、问数、可视化图表

SQLite 控制面
  -> 公司、门店、平台账号、群聊、员工、登录态、记忆、审计
  -> 负责权限、绑定关系、配置和任务状态
```

这样做的好处是：控制关系稳定、安全、可审计；经营数据可以高频导入、重算、聚合和可视化；后续如果要上云，也能从 DuckDB 数据集市迁移到服务端分析库。

## Why B Now

基于样例数据和当前代码，B 版最适合现在：

- 样例里同一家门店存在不同外部门店 ID，例如 CSV 和 Excel 的平台/来源 ID 不一致，因此不能把外部门店 ID 当成系统主键。
- 当前项目已经有 `stores`、`feishu_conversations`、`conversation_store_bindings`、`employees`、`platform_accounts`、`browser_profiles`、`memory_items` 和 `audit_events`。
- RPA 文件会持续变化，订单、商品、评价、门店快照适合放到分析层，而不是混进控制面。
- 日报、预警和问数都需要按日期、门店、平台、来源重算指标，DuckDB 比 SQLite 更适合做这类本地分析。
- 第一期仍然可以保持 Electron 本地运行，不需要先引入 PostgreSQL、ClickHouse 或服务端队列。

## Goals

- 接收外部 RPA/影刀数据，第一期支持 CSV/Excel，后续支持影刀数据库中转表和 API 回调。
- 建立公司、门店、平台账号、飞书群、员工之间的稳定绑定。
- 支持同一系统门店绑定多个平台/来源的外部门店 ID。
- 自动生成每日门店日报，并发送到绑定飞书群。
- 基于指标规则生成预警，例如营业额下降、订单异常、差评新增、商品销量突变。
- 支持 Agent 问数，例如“趣东北昨天美团营业额多少”“近 7 天差评原因占比”。
- 支持生成可视化图表，并以飞书卡片、图片或文件形式发送。
- 避免旧记忆系统污染经营数据：数字结论必须来自数据库，记忆只作为上下文和口径说明。

## Non-Goals

- 第一期不做云端多租户平台。
- 第一期不要求影刀直接调用系统 API；先处理已经下载到本地目录的文件，同时为数据库中转模式保留接入层边界。
- 第一期不把所有历史 Excel 字段都标准化，只覆盖日报、预警、问数所需字段。
- 第一期不让 LLM 自由拼 SQL 直接查库；Agent 通过受控工具和白名单指标查询。
- 不把 cookies、tokens、验证码、登录态 JSON 或敏感账号信息写入分析层。

## Existing Project Context

可复用的现有能力：

- `src/main/admin-control-plane/schema.ts`：已有控制面表。
- `src/main/admin-control-plane/service.ts`：已有门店、群聊绑定、平台账号、登录态、记忆、审计服务。
- `src/main/store-matcher/store-matcher.ts`：已有任务文本到门店/平台的匹配逻辑。
- `src/main/tools/store-management-tool.ts`：已有门店 CRUD。
- `src/main/tools/store-session-tool.ts`：已有门店登录态管理。
- `src/main/tools/feishu-card-tool.ts`：已有飞书卡片发送能力。
- `src/main/tools/feishu-card-callback.ts`：已有卡片按钮回调骨架。
- `src/shared/utils/sqlite-adapter.ts`：使用 Node `node:sqlite` 作为 SQLite 适配层。
- `xlsx` 已在 `optionalDependencies`，可以先用于 Excel 解析。
- `iconv-lite` 已可用于 GB18030 CSV 解码。

## Control Plane Model

SQLite 继续做业务关系的权威源。

### Company

当前项目面向内部使用，可先建一个默认公司。为后续服务端化保留 `company_id`。

建议新增：

```text
companies
  id
  name
  status
  created_at
  updated_at
```

建议给现有表补列：

```text
stores.company_id
employees.company_id
feishu_conversations.company_id
```

迁移时为已有数据写入默认公司 ID。

### Store

系统门店 ID 是内部主键，外部平台 ID 只做映射。

```text
stores
  id                    系统门店 ID
  company_id
  name
  brand
  city
  area
  aliases
  status
```

保留现有 `platform_store_id` 兼容旧数据，但后续不再作为核心字段使用。

### Platform Account And External Store Mapping

建议扩展 `platform_accounts`，或者新增更清晰的映射表。

推荐新增：

```text
store_external_ids
  id
  store_id              系统门店 ID
  platform              meituan / eleme / douyin / unknown
  source_app            rpa 应用或导出来源
  external_store_id     外部门店 ID
  external_store_name   文件里的门店名
  account_ref
  status
  first_seen_at
  last_seen_at
  created_at
  updated_at
```

唯一约束：

```text
platform + source_app + external_store_id
```

这样 CSV 里的 `28743970` 和 Excel 里的 `1294979950` 可以同时映射到同一个系统门店。

### Feishu Conversation Binding

飞书群绑定继续使用现有：

```text
feishu_conversations
conversation_store_bindings
```

重要规则：

- `conversation_id` 必须来自飞书消息元数据，不用群名手填。
- 群名如“测试3”只做展示名和人工识别线索。
- 当系统收到群消息时，如果存在 `conversationId`，可以自动 upsert 群聊记录，再由管理员绑定门店。
- 一个群可以绑定一个或多个门店；日报默认发到绑定门店所在群。

### Employee Binding

员工继续使用：

```text
employees
store_assignments
```

建议补充：

```text
conversation_members
  id
  conversation_id
  employee_id
  role
  status
  created_at
  updated_at
```

用途：

- 区分群负责人、运营、客服、观察者。
- 决定谁能触发日报重算、忽略预警、发起浏览器写操作。
- 私聊问数时，根据员工负责门店和权限过滤数据范围。

## Analytics Data Mart

DuckDB 存放本地分析数据。建议文件位置由应用数据目录管理，例如：

```text
data/analytics/store_ops.duckdb
data/raw-rpa/{batch_id}/...
```

### Layers

```text
raw_files
  记录每个下载文件、来源、哈希、编码、sheet、行数、导入状态

stg_*
  基本按原始字段落表，保留 source_file_id、batch_id、raw_payload

dim_*
  标准维表，例如 dim_store、dim_platform、dim_product

fact_*
  可分析事实表，例如 fact_orders、fact_products_daily、fact_reviews、fact_store_daily

mart_*
  面向日报、预警、问数的聚合表和视图
```

### Core Tables

```text
import_batches
  batch_id
  source_dir
  started_at
  completed_at
  status
  error

raw_files
  file_id
  batch_id
  file_path
  file_name
  file_hash
  file_type
  source_app
  platform_guess
  data_kind              store / order / product / review
  business_date_start
  business_date_end
  row_count
  status
  created_at

stg_store_daily_raw
stg_orders_raw
stg_products_raw
stg_reviews_raw

fact_store_daily
  store_id
  platform
  source_app
  business_date
  revenue
  order_count
  avg_order_value
  exposure_count
  visit_count
  conversion_rate
  store_score
  bad_review_count
  source_file_id
  loaded_at

fact_orders
  store_id
  platform
  source_app
  order_id
  business_date
  order_time
  completed_time
  paid_amount
  original_amount
  delivery_fee
  product_summary
  source_file_id
  loaded_at

fact_products_daily
  store_id
  platform
  source_app
  business_date
  product_name
  sku_name
  sales_count
  sales_amount
  good_review_count
  bad_review_count
  source_file_id
  loaded_at

fact_reviews
  store_id
  platform
  source_app
  review_id
  business_date
  review_time
  rating
  taste_rating
  delivery_rating
  content
  reply_content
  sentiment_tag
  source_file_id
  loaded_at
```

第一期允许字段不全，但表结构必须保留 `store_id`、`platform`、`source_app`、`business_date`、`source_file_id`，方便追溯。

## Import Flow

后续影刀如果能连接数据库，Import Flow 会从“单一文件导入”升级为“多入口接入”。核心原则不变：影刀可以写接入层或中转库，但不要直接写核心控制表、指标事实表、日报表或预警表。

```text
外部入口
  ├─ 文件目录：CSV / Excel
  ├─ 数据库中转：影刀写入 rpa_* 接入表或独立中转库
  └─ API 回调：后续系统提供受控接收接口

RPA Ingress 接入层
  -> 记录来源、批次、哈希/幂等键、字段版本、导入状态
  -> 保留原始数据或原始 payload
  -> 做字段标准化、门店映射、数据完整性检查
  -> 写入 DuckDB stg/fact/mart
```

不允许影刀直接写：

```text
stores
feishu_conversations
conversation_store_bindings
employees
memory_items
fact_orders
fact_store_daily
alert_events
report_runs
```

推荐允许影刀写：

```text
rpa_import_batches
rpa_raw_records
rpa_import_files
rpa_import_errors
```

或者让影刀写一个外部中转数据库，由本系统定时拉取、校验、去重后进入 DuckDB。

### File Directory Mode

```text
1. RPA 将文件下载到固定目录
2. 系统扫描目录，按文件名和内容判断 data_kind、日期、平台、门店名
3. 计算文件哈希，已导入文件直接跳过
4. 写入 SQLite 或 DuckDB 的导入批次记录
5. CSV 使用 GB18030/UTF-8 自动识别，Excel 读取 data sheet
6. 原始字段进入 stg 表
7. 根据 store_external_ids 映射到系统 store_id
8. 未识别门店进入待匹配队列，由管理员确认
9. 写入 fact 表和 mart 视图
10. 生成导入摘要，写审计日志
```

### Database Relay Mode

```text
1. 影刀将订单、商品、评价、门店快照写入中转表
2. 系统按 batch_id 或 updated_at 拉取新数据
3. 使用 external_record_id / content_hash 做幂等去重
4. 读取 source_app、platform、external_store_id、业务日期和字段版本
5. 原始记录进入 rpa_raw_records 或 DuckDB stg 表
6. 根据 store_external_ids 映射系统 store_id
7. 未识别门店进入待匹配队列
8. 标准化字段进入 fact 表和 mart 视图
9. 回写导入状态和错误原因
10. 生成导入摘要，写审计日志
```

### API Callback Mode

```text
1. 系统提供受控 API，影刀按批次推送数据
2. API 校验签名、来源、批次和 payload schema
3. 写入接入层原始记录，不直接写 fact 表
4. 后台任务异步标准化、映射和聚合
5. 返回批次状态查询接口
```

未识别门店处理：

```text
发现外部门店 ID + 门店名
  -> 精确匹配 stores.name / aliases
  -> 若唯一命中，建议绑定
  -> 若多命中或无命中，进入 pending mapping
  -> 管理员确认后写入 store_external_ids
```

## Metric Layer

不要让日报和问数散落在很多 SQL 里。建议建立一个指标服务。

```text
MetricService
  getDailySummary(storeIds, dateRange, platform?)
  getRevenueTrend(storeIds, dateRange, platform?)
  getOrderTrend(storeIds, dateRange, platform?)
  getReviewSummary(storeIds, dateRange, platform?)
  getProductRanking(storeIds, dateRange, platform?, limit?)
  comparePeriods(storeIds, currentRange, previousRange, platform?)
```

指标口径集中管理：

```text
metric_definitions
  metric_key
  display_name
  description
  unit
  source_table
  formula_sql
  owner
  status
  updated_at
```

第一期可以先把口径写在代码里，等验证稳定后再迁入表。

## LLM-Orchestrated Tool Flow

查询、问数、日报和图表不应该靠大量自然语言规则匹配硬编码。推荐方式是：LLM 负责判断用户意图和选择工具，工具负责权限、指标口径、数据库查询、结构化结果和审计。

```text
用户自然语言
  -> LLM 根据工具 schema 判断是否需要查数、日报、预警或图表
  -> 调用受控工具
  -> 工具读取 SQLite 控制面和 DuckDB 分析层
  -> 工具返回结构化 JSON
  -> LLM 用运营语言解释、总结和给建议
```

硬规则只保留在安全边界：

- 权限和范围：当前飞书群绑定哪些门店、当前用户能看哪些门店。
- 指标口径：营业额、订单数、客单价、差评数等由工具固定计算。
- 定时触发：每天几点生成日报由任务调度控制。
- 数据安全：LLM 不能自由拼 SQL，不能绕过 MetricService 查询任意表。
- 模糊兜底：当“昨天怎么样”这类问题缺少门店或平台时，优先使用当前群绑定门店；如果绑定多个门店，返回多门店概览或请用户选择。

## Daily Report Flow

```text
定时任务或手动触发
  -> 找到绑定门店和群聊
  -> 检查昨日数据是否完整
  -> 计算核心指标和环比
  -> 生成文字摘要
  -> 生成图表
  -> 发送飞书卡片/图片/文件
  -> 记录 report_runs
```

建议日报结构：

```text
1. 今日总览：营收、订单数、客单价、评分、差评数
2. 环比变化：对比前一日或近 7 日均值
3. 商品表现：销量前 5、下滑前 5
4. 评价问题：新增差评和关键词
5. Agent 建议：需要人工看、需要浏览器核查、需要继续观察
6. 数据完整性提示：哪些平台/文件缺失
```

## Warning Flow

预警不是记忆，也不是普通聊天记录，建议单独建表。

```text
alert_rules
  id
  company_id
  store_id
  platform
  metric_key
  condition_json
  severity
  status
  created_at
  updated_at

alert_events
  id
  rule_id
  store_id
  platform
  business_date
  severity
  title
  summary
  evidence_json
  status                open / acknowledged / ignored / resolved
  created_at
  updated_at

alert_notifications
  id
  alert_event_id
  conversation_id
  message_id
  sent_at
  status
```

第一期规则示例：

- 昨日营收低于近 7 日均值 30%。
- 订单数低于近 7 日均值 30%。
- 新增 1 星或 2 星差评。
- 评分低于阈值。
- 某商品销量连续 3 天下滑。
- 数据文件缺失或导入失败。

## Question Answering Flow

问数入口来自飞书群或私聊。LLM 负责选择工具和补齐自然语言上下文，但最终查询必须通过受控工具完成。

```text
用户问数
  -> 根据 connectorId + conversationId 找绑定门店
  -> 根据 senderId 找员工和权限
  -> LLM 根据工具 schema 选择 store_metrics / store_report / store_chart
  -> 工具内部解析日期、平台、指标，并调用 MetricService
  -> 返回结构化结果
  -> LLM 生成简明解释和运营建议
  -> 需要图表时生成 chart_spec
  -> 渲染图片或飞书图表卡片
  -> 记录 query_runs 和审计
```

示例：

```text
问：“趣东北昨天美团营业额多少？”
LLM 工具选择：
  tool = store_metrics.daily_summary
  store = 趣东北·东北小馆(石岩店)
  platform = meituan
  date = yesterday
  metric = revenue
工具执行：
  MetricService.getDailySummary(...)
回复：
  昨天美团营收 X 元，订单 Y 单，客单价 Z 元。较前一日变化 ...
```

## Visualization Flow

第一期用 ECharts 或轻量图表渲染服务生成 PNG，也可以先返回结构化 `chart_spec` 给前端或飞书卡片。

```text
chart_specs
  id
  query_run_id
  chart_type             line / bar / pie / table / card
  title
  spec_json
  image_path
  created_at
```

图表类型优先级：

- 趋势：折线图。
- 商品排行：横向柱状图。
- 差评原因：柱状图或饼图。
- 单日核心指标：飞书卡片指标块。
- 明细列表：表格。

## Memory Boundary

经营数据的权威来源是 DuckDB 和 SQLite 控制面，不是记忆。

记忆系统只保存：

- 企业级指标口径说明。
- 门店运营偏好和长期背景。
- 群聊正在跟进的任务上下文。
- 员工常用问数偏好。
- Agent 对历史问题的简短摘要。

旧 Markdown 记忆的影响控制：

- 不自动拆入日报和问数指标。
- 不作为数字结论的数据源。
- 不作为运行时 prompt 兜底上下文。
- 只能在管理员显式触发迁移时读取，并转成 `pending_review` 的结构化记忆候选。
- 与 SQLite 结构化事实冲突时，以 SQLite/DuckDB 为准。
- 未审核通过前，旧 Markdown 内容不得成为企业、群聊或个人记忆。

## Agent Tools

建议新增或扩展工具：

```text
rpa_data_import
  scan_directory
  import_files
  sync_relay_database
  receive_api_batch
  preview_batch
  list_batches
  list_unmatched_stores
  confirm_store_mapping

store_metrics
  daily_summary
  trend
  compare_periods
  product_ranking
  review_summary

store_report
  generate_daily_report
  send_daily_report
  list_report_runs

store_alerts
  evaluate_rules
  list_alerts
  acknowledge_alert
  ignore_alert

store_chart
  create_chart_spec
  render_chart_image
```

所有工具都要返回结构化 JSON，飞书展示由卡片工具负责。LLM 可以决定调用哪个工具，但工具必须自己完成权限过滤、指标口径、参数校验和审计记录。

## UI Surface

第一期 UI 不需要大而全，建议只做三个入口：

- 数据导入：选择目录、预览批次、确认未匹配门店、查看导入结果。
- 绑定关系：公司/门店/平台外部 ID/飞书群/员工负责人。
- 报表与预警：查看最近日报、手动重发、查看未处理预警。

已有 `StoreSessionManager` 可以作为门店配置入口，但建议不要把数据导入和报表预警都塞进去；后续可以新增 `StoreDataManager`。

## Implementation Phases

### Phase 1: Data Mart Foundation

- 添加 DuckDB 依赖和 `AnalyticsDatabase` 服务。
- 建立 raw/stg/fact/mart 基础表。
- 支持扫描样例目录并导入 CSV/Excel。
- 定义 RPA Ingress 接入层，保留数据库中转和 API 回调扩展点。
- 支持门店外部 ID 映射和待匹配队列。
- 写服务级测试覆盖重复导入、未知门店、GB18030 CSV、Excel data sheet。

### Phase 2: Metrics And Query Tools

- 建立 `MetricService`。
- 新增 `store_metrics` 工具。
- 支持 LLM 通过工具 schema 调用日报所需指标和基础问数。
- 按飞书群绑定关系过滤门店。
- 写测试覆盖群聊绑定门店、员工负责门店、指标口径。

### Phase 3: Reports And Alerts

- 新增 `report_runs`、`alert_rules`、`alert_events`。
- 生成日报文本和飞书卡片。
- 实现第一批预警规则。
- 支持预警确认、忽略和重算。

### Phase 4: Visualization

- 新增 `chart_specs`。
- 生成折线图、柱状图、表格图。
- 支持问数结果带图表。
- 支持日报附图。

## Risks

- 外部 RPA 字段可能变动：需要保留 raw/stg 层和导入错误提示。
- 影刀直连数据库可能误写正式表：必须只开放接入层或中转库，不开放核心控制表和事实表写权限。
- 同名门店或外部 ID 冲突：必须走 `store_external_ids` 和人工确认。
- 平台口径不同：美团、饿了么的补贴、实付、退款字段不能强行混算。
- Excel/CSV 日期可能来自文件名或内容：导入时要记录来源和置信度。
- 让 LLM 自由写 SQL 风险较高：第一期必须通过工具 schema 和 MetricService 白名单查询。
- 图表生成可能引入浏览器或 canvas 依赖：可先用前端/ECharts 渲染，服务端后置。

## Open Questions

- 外部 RPA 是否每天固定输出到同一个目录，还是影刀会优先写数据库中转表？
- 美团和饿了么是否都由同一个 RPA 应用下载？
- 日报默认统计“昨日”还是“最近一次完整数据日”？
- 群聊绑定是否允许一个群管多个门店？
- 问数时，私聊用户是否只能看自己负责门店？
- 首批预警阈值由管理员配置，还是先写死默认规则？

## References

- DuckDB Node.js client: https://duckdb.org/docs/stable/clients/nodejs/overview
- DuckDB CSV import: https://duckdb.org/docs/stable/data/csv/overview
- DuckDB SQLite extension: https://duckdb.org/docs/stable/core_extensions/sqlite
