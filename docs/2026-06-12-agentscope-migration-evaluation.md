# AgentScope-main 迁移适配评估

日期：2026-06-12

范围：基于当前 `docs/` 文档、`codegraph` 项目结构索引，以及本地 `/Users/dzcz/agentscope-main` 结构，对当前 `dzcz` 项目的业务目标画像和 Agent 框架选择进行评估。

说明：按当前决策要求，本文不再展开 CowAgent 对比。

---

## 1. 评估依据

### 1.1 当前项目资料

本次重点阅读和参考了以下文档：

- [`docs/点之出众-餐饮代运营AI智能助手-产品介绍.md`](./点之出众-餐饮代运营AI智能助手-产品介绍.md)
- [`docs/2026-06-11-full-module-design.md`](./2026-06-11-full-module-design.md)
- [`docs/ENTERPRISE_INTERNAL_AGENT_ROADMAP.md`](./ENTERPRISE_INTERNAL_AGENT_ROADMAP.md)
- [`docs/2026-06-10-feishu-layered-memory-mem0-design.md`](./2026-06-10-feishu-layered-memory-mem0-design.md)
- [`docs/飞书能力与餐饮代运营入口方案.md`](./飞书能力与餐饮代运营入口方案.md)
- [`docs/superpowers/specs/2026-06-10-dianbot-admin-memory-control-plane-design.md`](./superpowers/specs/2026-06-10-dianbot-admin-memory-control-plane-design.md)
- [`docs/superpowers/specs/2026-06-12-rpa-data-mart-agent-design.md`](./superpowers/specs/2026-06-12-rpa-data-mart-agent-design.md)
- [`docs/superpowers/specs/2026-06-09-business-task-policy-execution-design.md`](./superpowers/specs/2026-06-09-business-task-policy-execution-design.md)
- [`docs/superpowers/plans/2026-06-10-feishu-remote-assist-login-control-plane.md`](./superpowers/plans/2026-06-10-feishu-remote-assist-login-control-plane.md)

### 1.2 Codegraph 结构观察

当前 `dzcz` 项目已有 `.codegraph` 索引。

`codegraph status .` 结果概要：

- Files: 281
- Nodes: 3,815
- Edges: 10,526
- 主要语言：TypeScript、TSX、JavaScript
- 主要结构：
  - `src/main/agent-runtime`
  - `src/main/admin-control-plane`
  - `src/main/browser`
  - `src/main/browser-act`
  - `src/main/analytics`
  - `src/main/connectors`
  - `src/main/tools`
  - `src/renderer`
  - `src/server`

本地 `/Users/dzcz/agentscope-main` 也已有 `.codegraph` 索引。

`codegraph status /Users/dzcz/agentscope-main` 结果概要：

- Files: 532
- Nodes: 7,231
- Edges: 18,408
- 主要语言：Python、TSX、YAML、TypeScript
- 关键模块：
  - `src/agentscope/agent`
  - `src/agentscope/app`
  - `src/agentscope/app/message_bus`
  - `src/agentscope/middleware`
  - `src/agentscope/permission`
  - `src/agentscope/tool`
  - `src/agentscope/workspace`
  - `src/agentscope/mcp`
  - `src/agentscope/state`

一个必须提前正视的约束是：当前 `dzcz` 是 TypeScript/Electron 主进程项目，`agentscope-main` 是 Python 3.11/FastAPI 风格 runtime。因此迁移不是依赖替换，而更接近引入一个 Agent Runtime sidecar。

---

## 2. 当前项目业务目标画像

当前项目不是通用 AI 聊天助手，也不是个人本地 Agent。它的实际画像是：

> 面向线上餐饮代运营团队的 AI 运营执行系统。

产品目标可以概括为：

- 让约 10 人团队管理约 100 家门店。
- 用飞书作为统一入口，承载私聊、群聊、消息卡片、操作确认、日报、预警和知识问答。
- 用 AI Agent 替代大量重复性运营工作，让运营人员从数据搬运和后台巡检中释放出来。
- 先服务内部团队真实运营，再保留向行业产品化演进的可能性。

当前业务闭环主要包含：

1. **数据接入**
   - RPA/影刀导出的 Excel、CSV 或中转数据。
   - 外卖平台后台浏览器采集。
   - 飞书文档、多维表格、Wiki。
   - 本地 SQLite、DuckDB、向量/记忆 provider。

2. **数据分析**
   - 日报。
   - 预警。
   - 自然语言问数。
   - 门店、平台、时间范围下的指标查询和趋势分析。

3. **知识支持**
   - 运营 SOP。
   - 话术库。
   - 平台规则。
   - 门店经验。
   - 历史处置案例。

4. **浏览器执行**
   - 外卖平台后台读取。
   - 菜单、价格、图片、活动、门店信息等操作。
   - 写入操作需要确认、证据、审计和风险控制。

5. **团队协同**
   - 员工、角色、门店范围。
   - 飞书群聊和门店绑定。
   - 操作确认卡片。
   - 后续审批流。
   - 资源锁、任务队列、审计日志。

因此，项目的本质不是“Agent 能不能调用工具”，而是：

> 在企业运营场景下，让 Agent 安全地读取数据、引用知识、使用登录态、执行后台操作，并让团队可以管理、确认、追责和持续运营。

---

## 3. 系统边界画像

当前项目可以被拆成五层：

```text
飞书产品入口层
  私聊 / 群聊 / 消息卡片 / 确认 / 审批 / 文档 / Wiki / 多维表格

业务控制面
  员工 / 角色 / 门店 / 群聊绑定 / 平台账号 / 登录态引用 / 权限 / 审计

Agent Runtime 层
  对话状态 / 计划 / 工具选择 / 事件流 / 中间件 / 上下文压缩 / 模型调用

受控业务工具层
  问数 / 日报 / 预警 / 知识检索 / 浏览器读取 / 浏览器写入计划 / 确认后执行

事实与能力资产层
  SQLite 控制面 / DuckDB 分析层 / BrowserAct 登录态 / 飞书 Wiki / mem0 或其他记忆 provider
```

在这个画像里，Agent Runtime 只是中间一层。真正的产品资产在业务控制面、登录态管理、知识治理、经营数据和飞书交互上。

---

## 4. 当前记忆层与知识库问题的本质

当前不满意的“记忆层”和“知识库设计”，本质不是单纯缺少向量检索，也不是换成 mem0 就自然解决。

需要拆清四类对象：

### 4.1 结构化事实

包括：

- 公司。
- 员工。
- 角色。
- 门店。
- 飞书群聊。
- 门店和群聊绑定关系。
- 平台账号。
- 浏览器登录态引用。
- 权限。
- 审计。

这类信息应以 SQLite 控制面为权威来源。

### 4.2 经营数据

包括：

- 营业额。
- 订单数。
- 客单价。
- 评分。
- 差评。
- 曝光、转化、活动、菜品等运营指标。

这类信息应以 DuckDB/MetricService 为权威来源。

LLM 不能自由写 SQL，也不能从聊天记忆里猜经营数字。LLM 应负责判断意图和选择工具，工具负责权限、口径、查询、校验和审计。

### 4.3 知识库

包括：

- SOP。
- 平台规则。
- 话术库。
- 运营案例。
- 菜单优化经验。
- 门店处理规范。

知识库应是有来源、有版本、有权限、有适用范围的文档资产。飞书 Wiki 可以成为一个重要载体，但不应该和“记忆”混在同一个抽象里。

### 4.4 记忆

包括：

- 员工偏好。
- 群聊长期上下文。
- 门店运营偏好。
- 任务摘要。
- 非结构化经验片段。

记忆只能作为检索上下文，不应成为权威事实源。

推荐定义一个应用级 `MemoryGateway / KnowledgeGateway`：

```text
resolve employee + conversation + store scope
  -> 权限过滤
  -> 分层检索 enterprise / employee / conversation / store / task
  -> token budget
  -> 去重与排序
  -> 来源标注
  -> prompt sections 注入
```

mem0、飞书 Wiki、Markdown、向量库都可以是 provider，但治理权应保留在 `dzcz`。

---

## 5. 当前最大架构难点

结合 docs 和当前代码结构，项目真正难点集中在两个方向。

### 5.1 权限模型

需要回答的问题不是“这个工具能不能调用”，而是：

- 当前飞书消息是谁发的？
- 他属于哪个员工？
- 他在哪个群聊或私聊里？
- 这个群聊绑定了哪些门店？
- 他本人被分配了哪些门店？
- 他是否能看该门店数据？
- 他是否能使用某个平台账号或浏览器 Profile？
- 他是否能发起写操作？
- 写操作是什么风险等级？
- 是本人确认即可，还是需要管理员审批？
- 当前资源是否被别的任务占用？
- 操作证据和审计如何落地？

这要求权限引擎不仅看 tool name，还要看：

- actor。
- conversation。
- store scope。
- platform。
- account/profile。
- action level。
- risk level。
- task policy。
- resource lock。
- approval state。

### 5.2 浏览器态管理

登录态不是 prompt context，也不是普通配置。

它应该被视为生产运营资产：

- BrowserAct 或浏览器 profile 是真实 cookies/session 的持有者。
- SQLite 只保存引用、归属、风险级别、健康状态、最后使用时间和审计信息。
- raw cookies、tokens、passwords、验证码、storage state 不能进入 SQLite 业务表、记忆系统或 prompt。
- Agent 只应该看到 capability reference，例如：

```json
{
  "store": "望京店",
  "platform": "meituan",
  "browserProfileRef": "browser-act:chrome_local_1",
  "risk": "high_risk",
  "health": "ok",
  "allowedActionLevel": "high_risk_write"
}
```

Agent 不应该直接持有登录态秘密，也不应该决定哪个登录态可以被谁使用。

---

## 6. 框架选择结论

推荐结论：

> 选择 AgentScope-main 作为下一阶段 Agent Runtime / 编排层更适配，但不要让 AgentScope 接管 dzcz 的业务控制面、权限事实源、记忆治理、知识库、浏览器登录态和数据集市。

更精确的架构选择是：

```text
dzcz
  继续负责：
    - Electron / React 管理后台
    - 飞书连接器与产品交互
    - SQLite 控制面
    - DuckDB 分析层
    - BrowserAct 登录态控制面
    - 权限事实源
    - 知识库与记忆治理
    - 审计与证据

AgentScope-main
  作为 sidecar runtime 负责：
    - Agent loop
    - streaming event
    - middleware
    - permission hook
    - toolkit / tool group
    - workspace abstraction
    - multi-session / service 化能力
```

不建议现在做完全替换式迁移。建议做 runtime 边界重塑，让当前 pi-agent-core runtime 和 AgentScope runtime 都可以挂在同一套 `RuntimeDriver` 抽象后面。

---

## 7. 为什么 AgentScope-main 更适配当前画像

### 7.1 它更适合产品化 runtime，而不是单机脚本式 Agent

AgentScope-main 具备 app/service、message bus、workspace manager、middleware、toolkit、permission 等模块。这些结构更接近未来服务端化、多会话、多团队、多租户的方向。

当前项目虽然先以内部门店运营为主，但 docs 中已经明确保留后续行业产品化可能性。AgentScope 的服务化方向更贴近这个目标。

### 7.2 它的 middleware 适合承载横切治理逻辑

当前 `dzcz` 的 AgentRuntime 已经把这些逻辑揉在一起：

- 初始化 Agent。
- 加载工具。
- 包装工具。
- 注入工作提示词。
- 加载历史消息。
- 压缩上下文。
- 检查路径安全。
- 检测重复执行。
- 保存调试 prompt。
- 管理消息继续执行。

这些逻辑继续堆下去，会导致 runtime 越来越像一个大中枢。

AgentScope 的 middleware hook 更适合承载：

- 记忆注入。
- 权限检查。
- 审计记录。
- 工具调用前后证据采集。
- 高风险动作确认。
- 模型调用观测。
- prompt transform。
- context compression。

### 7.3 它的 permission engine 可以作为框架层拦截点

AgentScope 的 permission 模型可以承接 allow/deny/ask 这类工具执行前决策。

但注意：它不能直接替代 `dzcz` 的业务权限模型。

推荐方式是：

```text
AgentScope PermissionEngine
  -> 调用 dzcz PolicyService
    -> actor/conversation/store/platform/profile/action/risk/resource 判断
      -> allow / deny / confirm / approval_required
```

也就是说，AgentScope 提供 runtime hook，`dzcz` 提供业务决策。

### 7.4 它的 toolkit/tool group 适合业务工具包化

当前项目后续会不断增加：

- merchant ops 工具。
- RPA 数据工具。
- 飞书卡片工具。
- 飞书多维表格工具。
- 飞书 Wiki 工具。
- 登录态工具。
- 报告工具。
- 预警工具。

这些不应只是平铺到一个工具列表里，而应形成按业务域组织的 tool group/business pack。

AgentScope 的 `Toolkit / ToolGroup` 对这件事更天然。

### 7.5 它的事件流适合飞书确认卡片

当前业务里，高风险浏览器操作必须：

1. 生成计划。
2. dry-run。
3. 给出风险提示。
4. 通过飞书卡片确认。
5. 确认绑定具体计划。
6. 执行。
7. 验证。
8. 保存证据。
9. 审计。

AgentScope 的事件流模型可以自然映射成：

```text
RequireUserConfirmEvent
  -> dzcz 发送飞书确认卡片
  -> 用户点击确认/取消
  -> dzcz 回传确认结果
  -> AgentScope 继续或终止任务
```

这比把确认卡片硬塞进某个工具内部更适合长期产品化。

---

## 8. 不应迁给框架的部分

以下部分应保留在 `dzcz`：

### 8.1 业务控制面

包括：

- 员工。
- 角色。
- 门店。
- 门店分组。
- 飞书群聊。
- 群聊与门店绑定。
- 平台账号。
- 浏览器 profile 引用。
- 登录请求。
- 风险等级。
- 审计日志。

这些是产品的治理资产，不是 Agent 框架内部状态。

### 8.2 浏览器登录态

登录态必须继续作为能力资产管理：

- BrowserAct 持有实际登录态。
- SQLite 持有引用和治理元数据。
- Agent 只拿 capability reference。
- raw secrets 不进入 prompt、记忆或模型上下文。

### 8.3 经营数据

经营数据应进入 DuckDB/MetricService。

Agent 只能调用受控查询工具，不应自由 SQL，也不应从 memory 生成数字结论。

### 8.4 知识库和记忆治理

AgentScope 可以接收注入后的 memory/knowledge context，但不应该成为：

- 企业知识库后台。
- 门店 SOP 权威源。
- 员工权限源。
- 记忆审核系统。
- 敏感信息过滤源。

这些都应属于 `dzcz` 应用层。

### 8.5 飞书交互层

飞书卡片、审批、群聊、私聊、文档、多维表格，是产品体验核心。它们应该继续由 `dzcz` connector 和工具层控制。

---

## 9. 推荐目标架构

```text
┌─────────────────────────────────────────────────────────┐
│ 飞书入口层                                                │
│ 私聊 / 群聊 / 卡片 / 审批 / 文档 / Wiki / 多维表格          │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│ dzcz Product Control Plane                               │
│ Employee / Role / StoreScope / Conversation / Account     │
│ BrowserProfileRef / Permission / Approval / Audit         │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│ RuntimeDriver                                             │
│ sendMessage / streamEvents / continue / cancel            │
│ 当前 pi-agent-core runtime 与 AgentScope sidecar 可并存     │
└───────────────┬──────────────────────────┬───────────────┘
                │                          │
┌───────────────▼───────────────┐  ┌───────▼────────────────┐
│ Current Runtime                │  │ AgentScope Runtime      │
│ TypeScript / pi-agent-core     │  │ Python / FastAPI        │
└───────────────┬───────────────┘  └───────┬────────────────┘
                │                          │
                └──────────────┬───────────┘
                               │
┌──────────────────────────────▼───────────────────────────┐
│ dzcz Governed Tool APIs                                   │
│ PolicyService / CapabilityService / MetricService          │
│ KnowledgeGateway / MemoryGateway / BrowserActControl       │
└──────────────────────────────┬───────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────┐
│ Fact and Capability Assets                                │
│ SQLite / DuckDB / BrowserAct / Feishu Wiki / mem0 Provider │
└───────────────────────────────────────────────────────────┘
```

---

## 10. 建议迁移路线

### Phase 0：冻结边界，不急于替换 runtime

目标：先把边界定下来。

输出：

- `RuntimeDriver` 接口。
- `PolicyService` 接口。
- `CapabilityService` 接口。
- `MemoryGateway` 接口。
- `KnowledgeGateway` 接口。
- `TaskEvent / AuditEvent / Evidence` 基础 schema。

这一阶段不要求 AgentScope 真正跑生产任务。

### Phase 1：让现有 runtime 走新边界

目标：当前 pi-agent-core runtime 也必须通过新服务边界调用工具。

重点：

- 浏览器工具不直接拿登录态。
- 工具调用前统一走权限检查。
- 高风险操作统一 dry-run。
- 确认卡片和确认结果绑定具体 plan。
- 审计和证据统一落表。

如果当前 runtime 都能接入这套边界，后续切 AgentScope 风险会低很多。

### Phase 2：AgentScope sidecar 跑只读链路

优先迁移低风险场景：

- SOP/Wiki 检索。
- 门店问数。
- 日报摘要。
- 预警解释。
- 浏览器页面读取。

验收重点：

- 飞书消息能进入 AgentScope。
- AgentScope 能 stream event 回 dzcz。
- AgentScope 能调用 dzcz 受控工具。
- 记忆和知识上下文由 dzcz 注入。
- 审计能落回 dzcz。

### Phase 3：接入确认事件

目标：把高风险前置确认跑通，但仍先不做复杂写操作。

重点：

- AgentScope 产生确认请求事件。
- dzcz 发送飞书卡片。
- 用户点击确认/取消。
- dzcz 将结果回传 runtime。
- runtime 根据确认继续或停止。

### Phase 4：迁移浏览器写操作

目标：迁移真正高风险生产动作。

前置条件：

- `PolicyService` 稳定。
- `ResourceLockService` 稳定。
- `BrowserProfileRef` 权限稳定。
- Evidence 保存稳定。
- Feishu confirmation 稳定。
- 操作失败可恢复。

第一批建议只做单门店、单平台、低频写操作，不要一开始就做批量改价或活动发布。

---

## 11. 风险与注意事项

### 11.1 跨语言 sidecar 复杂度

AgentScope 是 Python，当前主项目是 TypeScript/Electron。

需要增加：

- Python runtime 启动和守护。
- 本地端口或 IPC。
- 打包/安装/升级策略。
- 日志聚合。
- 失败重启。
- Electron 和 sidecar 的版本兼容。

所以不适合“一步替换”。适合先并行试运行。

### 11.2 不要把业务权限降级成工具权限

工具权限只能回答“能不能调用某个工具”。

业务权限必须回答“谁在什么上下文里，对哪个门店、哪个平台、哪个登录态、做什么风险等级的动作，是否允许”。

这部分必须由 `dzcz` 控制面负责。

### 11.3 不要让 memory 重新污染事实源

迁移 AgentScope 或 mem0 后，也必须坚持：

- 经营数字来自 DuckDB/SQLite。
- 权限来自 SQLite。
- 登录态来自 BrowserAct capability。
- 知识来自 Wiki/文档 provider。
- memory 只是上下文。

### 11.4 不要暴露 raw browser primitive 给高风险业务任务

读操作可以相对动态。

写操作必须经过：

```text
业务工具 -> policy -> dry-run -> confirmation -> execution -> verification -> evidence -> audit
```

不能让 Agent 直接通过 raw browser tool 自由点击生产后台。

---

## 12. 最终建议

当前项目才二开两天，历史包袱较轻，工具迁移痛点主要是注册和适配。因此现在反而是做 runtime 边界重塑的窗口期。

最终建议：

> 采用 AgentScope-main 作为下一阶段 Agent Runtime / 编排层方向，但采用 sidecar 和 `RuntimeDriver` 双轨迁移，而不是替换式重写。

具体保留与迁移边界：

| 模块 | 建议归属 | 理由 |
| --- | --- | --- |
| 飞书入口、卡片、审批、群聊 | dzcz | 产品体验核心 |
| Electron/React 管理后台 | dzcz | 当前团队运营控制面 |
| 员工、门店、角色、群聊绑定 | dzcz SQLite | 权限事实源 |
| 浏览器登录态 | dzcz + BrowserAct | 生产能力资产，不进 prompt |
| 经营数据 | dzcz DuckDB/MetricService | 数字事实源 |
| 知识库治理 | dzcz KnowledgeGateway | 需要来源、权限、版本 |
| 记忆治理 | dzcz MemoryGateway | 需要分层、审核、敏感过滤 |
| Agent loop | AgentScope 可承接 | 更适合事件流和产品化 runtime |
| ToolGroup/Toolkit | AgentScope 可承接 | 适合业务工具包化 |
| Middleware | AgentScope 可承接 | 适合权限、审计、记忆注入 |
| Permission hook | AgentScope + dzcz PolicyService | 框架拦截，业务决策仍在 dzcz |

一句话总结：

> AgentScope 适合接管“Agent 怎么运行”，不适合接管“业务世界是什么、谁有权做什么、登录态在哪里、数据事实是什么”。

