# 点之出众 - 全模块设计方案

> 文档版本：v1.0
> 更新日期：2026-06-11
> 作者：点之出众技术团队

---

## 1. 总体目标

将点之出众做成**餐饮代运营行业的 AI 垂直工具**，先内部跑通验证，再面向同一行业做定制化开发。

**产品形态**：Electron 桌面端常驻运行（Mac），运营人员通过飞书 Bot 使用。

**核心原则**：当前最重要的不是功能堆砌，而是**让运营人员真正深度使用起来**。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        飞书 Bot（主入口）                         │
│  运营人员在飞书群里 @Bot 发任务，Bot 是执行者                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket 长连接
┌──────────────────────────▼──────────────────────────────────────┐
│                    Electron 主进程（Mac 常驻）                    │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Gateway   │  │ Connector    │  │ Admin        │              │
│  │ 消息路由   │  │ Manager      │  │ Control      │              │
│  │           │  │ 飞书/微信/企微 │  │ Plane        │              │
│  └─────┬─────┘  └──────────────┘  └──────────────┘              │
│        │                                                         │
│  ┌─────▼─────────────────────────────────────────────┐          │
│  │              Agent Runtime（per-Tab 隔离）          │          │
│  │                                                     │          │
│  │  Tab A (飞书群1) → AgentRuntime A → LLM 调用       │          │
│  │  Tab B (飞书群2) → AgentRuntime B → LLM 调用       │          │
│  │  Tab C (飞书群3) → AgentRuntime C → LLM 调用       │          │
│  └─────────────────────────────────────────────────────┘          │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ 浏览器    │  │ 工具链    │  │ 记忆系统  │  │ 门店数据  │        │
│  │ 自动化    │  │ 58+ 工具  │  │ 三层架构  │  │ 查询     │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块一：浏览器自动化引擎

**优先级：P0**

### 3.1 现状

项目有两套浏览器自动化能力：

| 工具 | 位置 | 能力 |
|------|------|------|
| `agent-browser` | `src/main/browser/` | 基于 Playwright 的 CLI，支持打开网页、获取快照、点击、填充表单、截图 |
| `browser-act` | `src/main/browser-act/` | 独立 CLI 工具，用于飞书入口下的商家后台自动化 |

当前 `browser-tool.ts` 已封装 `agent-browser`，支持 `@ref` 系统定位元素。

### 3.2 问题

1. **登录态管理**：商家后台需要登录，当前没有统一的登录态管理方案
2. **多平台适配**：美团、饿了么、京东的商家后台界面不同，需要分别适配
3. **操作可靠性**：页面加载慢、元素定位失败、验证码等异常处理
4. **操作确认**：写入操作（改价、改图、下活动）需要人工确认

### 3.3 方案

#### 3.3.1 登录态管理

利用已有的 `admin-control-plane` 中的 `browser_profiles` 和 `browser_login_requests` 表。

**登录流程**：

```
Agent 发现需要登录
  │
  ├─ 调用 browser_login_request 工具
  │
  ├─ 系统创建登录请求
  │   └─ 通过飞书消息卡片通知运营人员
  │
  ├─ 运营人员点击卡片
  │   └─ 打开浏览器 → 手动登录
  │
  ├─ 登录成功
  │   └─ 系统保存 storage_state → 后续操作复用
  │
  └─ 登录过期
      └─ 自动检测 → 重新发起登录请求
```

**已有基础**：`browser-act-login-flow.ts` 和 `login-command-handler.ts` 已实现飞书远程辅助登录流程。

#### 3.3.2 多平台适配

不写死平台逻辑，让 AI 自己判断页面结构。

**Agent 工具**：

| 工具 | 功能 |
|------|------|
| `browser_snapshot` | 获取当前页面快照（元素列表 + 文本） |
| `browser_click` | 点击元素（@ref 定位） |
| `browser_fill` | 填充表单 |
| `browser_navigate` | 导航到 URL |
| `browser_screenshot` | 截图（视觉确认用） |

**AI 能力**：
- 理解页面结构（通过 snapshot 的元素列表）
- 根据用户意图规划操作步骤
- 遇到未知页面时截图请求人工指导

#### 3.3.3 操作确认机制

对于写入操作，采用**分级确认**：

| 操作级别 | 示例 | 确认方式 |
|---------|------|---------|
| 只读 | 查看数据、截图 | 无需确认 |
| 低风险 | 修改菜品描述 | 飞书卡片确认 |
| 中风险 | 修改价格、下掉活动 | 飞书卡片确认 + 管理员审批 |
| 高风险 | 批量修改、删除操作 | 飞书卡片确认 + 管理员审批 + 二次确认 |

**飞书确认卡片示例**：

```
┌──────────────────────────────┐
│ 📋 价格调整确认               │
│                              │
│ 门店：趣东北·东北小馆(石岩店) │
│ 菜品：锅包肉双人套餐          │
│ 当前价格：94.00 元            │
│ 建议价格：89.00 元            │
│ 原因：近 7 天销量下降 15%     │
│                              │
│ [确认修改]  [修改价格]  [忽略] │
└──────────────────────────────┘
```

### 3.4 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/browser/session-manager.ts` | **新增** | 浏览器会话管理（登录态存储、复用、过期检测） |
| `src/main/browser/action-confirmation.ts` | **新增** | 操作确认机制（飞书卡片确认流） |
| `src/main/tools/browser-tool.ts` | **修改** | 集成登录态管理和操作确认 |
| `src/main/connectors/feishu/confirmation-card.ts` | **新增** | 飞书确认卡片模板 |

---

## 4. 模块二：飞书 Bot 交互优化

**优先级：P1**

### 4.1 现状

当前飞书 Bot 已支持：

| 能力 | 工具 |
|------|------|
| 文本消息收发 | `feishu_send_message` |
| 图片/文件发送 | `feishu_send_image`、`feishu_send_file` |
| 消息卡片 | `feishu_send_card`、`feishu_update_card` |
| 多维表格 | `feishu_bitable_*` |
| 云文档 | `feishu_doc_*` |

### 4.2 需要增强

#### 4.2.1 任务状态追踪

运营人员发了一个复杂任务（如"帮我检查趣东北的美团页面"），AI 可能需要几分钟才能完成。

**流程**：

```
1. 收到任务 → 立即回复"收到，正在处理..."（飞书卡片）
2. 执行中 → 每 30 秒更新一次进度（通过飞书卡片更新）
3. 执行完成 → 更新卡片为最终结果
4. 执行失败 → 更新卡片为错误信息 + 重试建议
```

**已有基础**：`gateway-connector.ts` 中的 `PROGRESS_CHECKPOINTS` 已实现进度提醒，但只是文本消息，需要改为**可更新的飞书卡片**。

**进度卡片示例**：

```
┌──────────────────────────────┐
│ 🔄 任务执行中                 │
│                              │
│ 任务：检查趣东北美团页面       │
│ 进度：正在获取页面快照...     │
│ 耗时：已运行 45 秒            │
│                              │
│ [查看进度]  [停止任务]        │
└──────────────────────────────┘

        ↓ 执行完成后更新为 ↓

┌──────────────────────────────┐
│ ✅ 任务完成                   │
│                              │
│ 门店：趣东北·东北小馆(石岩店) │
│                              │
│ 检查结果：                    │
│ • 菜品数量：32 个（正常）     │
│ • 价格异常：2 个              │
│   - 锅包肉套餐：页面 89 元    │
│     ，数据库 94 元            │
│   - 小米南瓜粥：页面 3.8 元   │
│     ，数据库 5 元             │
│ • 图片缺失：1 个（杀猪菜）    │
│                              │
│ [查看详情]  [一键修复]        │
└──────────────────────────────┘
```

#### 4.2.2 卡片交互流

AI 发送的操作确认卡片支持按钮交互：

- 点击"确认修改" → Agent 执行浏览器自动化修改
- 点击"修改价格" → 弹出输入框，运营人员输入新价格
- 点击"忽略" → 记录到记忆，下次不再建议

#### 4.2.3 消息队列

当前 `gateway-message.ts` 中已有消息队列机制：

- 同一群聊内消息严格串行（`isCurrentlyGenerating()` 检查 + 消息队列）
- 不同群聊消息完全独立（per-Tab 隔离）
- 长时间运行的任务不阻塞其他群聊

### 4.3 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/connectors/feishu/progress-card.ts` | **新增** | 可更新的进度卡片模板 |
| `src/main/connectors/feishu/confirmation-card.ts` | **新增** | 操作确认卡片模板 |
| `src/main/gateway-connector.ts` | **修改** | 集成进度卡片更新 |
| `src/main/connectors/feishu/feishu-connector.ts` | **修改** | 增强卡片交互处理 |

---

## 5. 模块三：Agent 工具链

**优先级：P1**

### 5.1 现状

当前有 58 个工具，涵盖文件操作、浏览器、飞书、微信、企微等。

### 5.2 需要新增的工具

#### 5.2.1 门店数据查询工具

```typescript
// store-data-tool.ts
{
  name: 'store_data',
  description: '查询门店经营数据（营收、订单、商品、评价）',
  actions: [
    'query_metrics',    // 查询门店经营指标（营收、订单数、评分）
    'query_products',   // 查询商品销售数据（销量、好评/差评）
    'query_orders',     // 查询订单详情
    'query_reviews',    // 查询评价数据
    'compare_periods',  // 对比两个时间段的数据
  ],
}
```

**数据来源**：从影刀外包的数据接口连接数据库，数据格式包括：

| 数据类型 | 关键字段 |
|---------|---------|
| 门店数据 | 门店名称、门店id、城市、区县、营业收入、店铺分、曝光人数、入店转化率 |
| 商品数据 | 商品名、销量、销售额、好评数、差评数 |
| 订单数据 | 订单编号、下单时间、商品信息、活动信息、订单实付、配送费 |
| 评价数据 | 评价时间、评分、评价内容、商家回复、配送满意度 |

#### 5.2.2 记忆管理工具（增强）

```typescript
// memory-tool.ts（增强版）
{
  name: 'memory',
  actions: [
    'read',           // 读取记忆
    'update',         // 更新记忆
    'delete',         // 删除记忆
    'search',         // 搜索记忆（语义搜索，基于 mem0）
    'list_by_store',  // 列出某门店的所有记忆
  ],
}
```

#### 5.2.3 操作确认工具

```typescript
// confirmation-tool.ts
{
  name: 'confirm_action',
  description: '需要人工确认的操作，发送飞书卡片等待确认',
  parameters: {
    action: 'send_confirmation',
    title: '价格调整确认',
    details: { storeName, productName, currentPrice, suggestedPrice, reason },
    riskLevel: 'medium',
  },
}
```

### 5.3 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/tools/store-data-tool.ts` | **新增** | 门店数据查询工具 |
| `src/main/tools/store-data-schema.ts` | **新增** | 门店数据表结构 |
| `src/main/tools/confirmation-tool.ts` | **新增** | 操作确认工具 |
| `src/main/tools/memory-tool.ts` | **修改** | 增强记忆搜索能力 |
| `src/main/tools/tool-groups.ts` | **修改** | 将新工具加入渐进式披露分组 |

---

## 6. 模块四：单进程并发

**优先级：P2**

### 6.1 现状分析

当前架构：

```
Electron 主进程
  └─ Gateway
       ├─ Tab A (飞书群1) → AgentRuntime A → LLM 调用（异步）
       ├─ Tab B (飞书群2) → AgentRuntime B → LLM 调用（异步）
       └─ Tab C (飞书群3) → AgentRuntime C → LLM 调用（异步）
```

**关键点**：
- 每个 Tab 有独立的 AgentRuntime 实例（`agentRuntimes: Map<string, AgentRuntime>`）
- 同一 Tab 内的消息串行处理（`isCurrentlyGenerating()` 检查 + 消息队列）
- 不同 Tab 的 AgentRuntime 互不阻塞（异步 LLM 调用）

Node.js 的异步模型天然支持这种并发——LLM 调用是 I/O 操作，不会阻塞事件循环。

### 6.2 真正的瓶颈

| 瓶颈 | 说明 | 影响 |
|------|------|------|
| CPU 密集 | 浏览器自动化（Playwright）占用 CPU | 多个浏览器实例同时运行可能导致卡顿 |
| 内存膨胀 | 每个 AgentRuntime + 58 个工具实例 + 消息历史 | N 个 Tab × 58 个工具 = 内存压力 |
| API 限流 | 同一 API Key 多个请求并发 | 触发服务商限流 |

### 6.3 解决方案

#### 6.3.1 浏览器实例池

```typescript
// browser-pool.ts
class BrowserPool {
  private maxConcurrent = 3; // 最多同时 3 个浏览器实例
  private queue: Array<() => Promise<void>> = [];
  private running = 0;

  async execute(task: () => Promise<void>): Promise<void> {
    if (this.running >= this.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      await task();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}
```

#### 6.3.2 工具懒加载

不在初始化时加载所有工具，而是按需加载：

```typescript
// 当前：初始化时加载 58 个工具
const tools = await toolLoader.loadAllTools();

// 优化：只加载核心工具，按需加载其他
const coreTools = await toolLoader.loadCoreTools(); // 6 个
// 其他工具在首次使用时动态加载
```

#### 6.3.3 LLM 调用队列

```typescript
// 防止 API 限流，对同一 provider 的请求排队
class LLMCallQueue {
  private queues = new Map<string, Array<() => Promise<void>>>();

  async enqueue(provider: string, task: () => Promise<void>): Promise<void> {
    // 同一 provider 的请求串行执行
    // 不同 provider 的请求并发执行
  }
}
```

### 6.4 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/browser/browser-pool.ts` | **新增** | 浏览器实例池 |
| `src/main/tools/tool-loader.ts` | **修改** | 工具懒加载 |
| `src/main/utils/llm-queue.ts` | **新增** | LLM 调用队列 |

---

## 7. 模块五：三层记忆架构

**优先级：P0**

### 7.1 现状

项目有两套独立的记忆系统：

1. **旧版 memory-tool**：基于 Markdown 文件，按 Tab 隔离，用 LLM 提炼更新
2. **admin-control-plane**：基于 SQLite，已定义 `MemoryScope`（enterprise/employee/conversation/store/task），有 mem0 集成，有记忆审核流程

**问题**：两套系统没有打通，且 admin-control-plane 的记忆系统还没有被 Agent 实际使用。

### 7.2 三层架构设计

```
┌─────────────────────────────────────────────────┐
│                   Layer 1: 企业记忆               │
│               scope = 'enterprise'               │
│                                                   │
│  • 企业话术库、定价策略、平台规则、SOP            │
│  • 管理员维护，只读给所有 Agent                   │
│  • 存储：SQLite memory_items + mem0 同步          │
│  • 注入方式：系统提示词（每次 LLM 调用）          │
└───────────────────────┬─────────────────────────┘
                        │ 继承
┌───────────────────────▼─────────────────────────┐
│               Layer 2: 门店/群聊记忆              │
│          scope = 'store' / 'conversation'         │
│                                                   │
│  • 门店画像、历史数据摘要、菜品结构、经营规律     │
│  • 群聊对话中 AI 自动提取 + 数据导入             │
│  • 群内所有运营人员共享                           │
│  • 存储：SQLite memory_items + mem0 同步          │
│  • 注入方式：按 conversation_id 查询注入          │
└───────────────────────┬─────────────────────────┘
                        │ 继承
┌───────────────────────▼─────────────────────────┐
│               Layer 3: 个人记忆                   │
│            scope = 'employee'                     │
│                                                   │
│  • 个人工作偏好、常用操作、习惯用语               │
│  • 跟随用户，跨群生效                             │
│  • 只有本人可见                                   │
│  • 存储：SQLite memory_items + mem0 同步          │
│  • 注入方式：按 employee_id 查询注入              │
└─────────────────────────────────────────────────┘
```

### 7.3 记忆来源与生命周期

| 层级 | 来源 | 写入方式 | 审核 | 过期 |
|------|------|---------|------|------|
| 企业 | 管理员手动维护 | 管理后台 UI | 管理员审核 | 永不过期 |
| 门店/群聊 | AI 从对话中自动提取 + 数据导入 | Agent 自动写入 | 可配置自动通过或人工审核 | 可设 TTL |
| 个人 | AI 从对话中学习偏好 | Agent 自动写入 | 自动通过 | 可设 TTL |

### 7.4 记忆注入流程

每次 LLM 调用前：

```
用户消息到达
  │
  ├─ 1. 查询企业记忆（所有 active 状态）
  │     → 注入系统提示词的"企业记忆"段落
  │
  ├─ 2. 查询门店/群聊记忆
  │     → 根据 conversation_id 找到绑定的 store_id
  │     → 查询该 store + 该 conversation 的 active 记忆
  │     → 注入系统提示词的"门店记忆"段落
  │
  └─ 3. 查询个人记忆
        → 根据发送者 user_id 找到 employee_id
        → 查询该 employee 的 active 记忆
        → 注入系统提示词的"个人记忆"段落
```

### 7.5 记忆自动提取流程

每次 Agent 回复后：

```
Agent 回复完成
  │
  ├─ 1. 判断是否包含值得记忆的信息
  │     → 使用 LLM 判断（轻量级 prompt）
  │     → 或规则匹配（包含价格、菜品名、活动等关键词）
  │
  ├─ 2. 如果是，提取记忆内容
  │     → 生成结构化的记忆条目
  │     → scope: store/conversation/employee
  │     → category: 价格/菜品/活动/评价/偏好/其他
  │     → confidence: 0-1
  │
  └─ 3. 写入记忆系统
        → SQLite memory_items
        → mem0 同步（如果启用）
        → 根据 confidence 决定是否需要人工审核
```

### 7.6 已有基础（直接复用）

| 组件 | 说明 |
|------|------|
| `admin-control-plane/schema.ts` | `memory_items`、`memory_sources`、`memory_entity_links`、`memory_reviews`、`memory_versions` 表已定义 |
| `admin-control-plane/mem0-provider.ts` | mem0 集成已实现 |
| `admin-control-plane/service.ts` | 记忆 CRUD 操作已实现 |
| `admin-control-plane/prompt-context.ts` | 记忆注入提示词已实现 |
| `types/admin-control-plane.ts` | `MemoryScope`、`MemoryStatus` 等类型已定义 |

### 7.7 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/memory/memory-service.ts` | **新增** | 统一的记忆服务（三层读写、注入、提取） |
| `src/main/memory/memory-extractor.ts` | **新增** | 从对话中自动提取记忆 |
| `src/main/prompts/system-prompt.ts` | **修改** | 统一三层记忆注入 |
| `src/main/prompts/memory-sections.ts` | **修改** | 适配新的记忆结构 |
| `src/main/agent-runtime/agent-message-processor.ts` | **修改** | 添加记忆自动提取 |

---

## 8. 实施优先级（已更新）

> **更新说明**：根据 2026-06-11 讨论，Phase 1 范围聚焦于**门店 + 登录态会话管理**，移除权限管理和审批流程，简化配置流程。

### Phase 1：核心闭环（让运营人员能用起来）

**范围调整**：
- ✅ 门店管理 + 登录态会话管理
- ❌ 权限管理（推迟到 Phase 2）
- ❌ 审批流程（仅飞书卡片确认，无多级审批）

| 模块 | 内容 | 目标 | 实现状态 |
|------|------|------|----------|
| 门店管理 | 门店 CRUD + 别名 + 批量导入 | 管理门店基础信息 | ✅ 已完成 |
| 登录态管理 | 一站式配置 UI + 平台会话管理 | 配置商家后台登录态 | ✅ 已完成 |
| AI 匹配 | 根据任务描述匹配门店和登录态 | AI 自动选择正确的登录态 | ✅ 已完成 |
| 记忆架构 | Phase 1：统一记忆注入 | Agent 能读到三层记忆 | ⏳ 待实现 |
| 门店数据 | 数据表 + 查询工具 | Agent 能查询经营数据 | ⏳ 待实现 |

**Phase 1 完成后，运营人员应该能够**：
1. ✅ 在 Electron 管理后台一站式配置门店和登录态（已完成）
2. ⏳ 在飞书群里说"帮我看看趣东北昨天的经营数据" → AI 查询数据库 → 飞书回复数据摘要
3. ⏳ 在飞书群里说"帮我看看趣东北美团页面的菜品信息" → AI 打开浏览器 → 获取页面信息 → 飞书回复对比结果
4. ⏳ AI 在对话中自动记住"趣东北的锅包肉套餐卖 94 元" → 下次对话时能直接引用
5. ⏳ 管理员在管理后台设置企业话术库 → 所有群聊的 AI 都能使用

**AI 匹配登录态流程**：
```
用户在飞书群发任务："帮我看看趣东北美团页面的菜品信息"
  │
  ├─ 1. 解析任务描述，提取门店名称和平台
  │     → 门店：趣东北（支持别名匹配）
  │     → 平台：美团
  │
  ├─ 2. 匹配门店（精确匹配 → 别名匹配 → 模糊匹配）
  │     → 找到：趣东北·东北小馆(石岩店)
  │
  ├─ 3. 匹配登录态（根据门店 + 平台）
  │     → 找到：美团登录态
  │
  ├─ 4. 如果匹配到多个登录态
  │     → 飞书卡片询问用户选择
  │
  └─ 5. 执行浏览器自动化操作
        → 使用匹配到的登录态打开美团商家后台
```

**操作确认机制**（简化版）：
- 所有写入操作（改价、改图、下活动）在**执行前**通过飞书卡片确认
- 无多级审批流程，点击确认即执行
- 确认卡片包含：操作详情 + 风险提示 + 确认/取消按钮

### Phase 2：体验优化

| 模块 | 内容 |
|------|------|
| 权限管理 | 公司 → 群组 → 员工权限模型，绑定到登录态 |
| 飞书交互 | 可更新的进度卡片、操作确认卡片交互流 |
| 浏览器自动化 | 远程登录（BrowserAct）集成 |
| 记忆架构 | Phase 2：记忆自动提取 |

**权限模型设计**（Phase 2）：
```
公司级别
  └─ 可使用全部登录态
     │
     ├─ 群组级别（运营群）
     │   └─ 可使用部分登录态（按门店分组）
     │
     └─ 员工级别
         └─ 可使用具体几个登录态（按个人分配）
```

### Phase 3：性能优化

| 模块 | 内容 |
|------|------|
| 并发 | 浏览器实例池、工具懒加载、LLM 调用队列 |

---

## 8.1 Phase 1 实现状态追踪

### 8.1.1 已完成的功能 ✅

#### 门店管理
- [x] 门店 CRUD（创建、读取、更新、删除）
- [x] 门店别名支持（多个别名，逗号分隔）
- [x] 门店状态管理（营业中、暂停、关闭）
- [x] 门店元数据（品牌、城市、区域）
- [x] 批量导入/导出（Excel 格式）

**相关文件**：
- `src/types/admin-control-plane.ts` - `AdminStore`, `CreateStoreInput` 类型
- `src/main/admin-control-plane/schema.ts` - `stores` 表（含 `aliases` 列）
- `src/main/admin-control-plane/service.ts` - 门店 CRUD 逻辑
- `src/main/tools/store-management-tool.ts` - 5 个工具：`store_create`, `store_update`, `store_delete`, `store_list`, `store_get`
- `src/main/tools/store-import-tool.ts` - 2 个工具：`store_import`, `store_export`

#### 登录态会话管理
- [x] 平台会话配置（美团、饿了么、京东）
- [x] 本地登录模式（粘贴 Cookie JSON）
- [x] 远程登录模式（BrowserAct，开发中）
- [x] 会话测试功能
- [x] 会话删除功能

**相关文件**：
- `src/main/tools/store-session-tool.ts` - 5 个工具：`store_session_match`, `store_session_create`, `store_session_update`, `store_session_test`, `store_session_delete`
- `src/main/store-matcher/store-matcher.ts` - 任务解析 + 门店匹配
- `src/main/store-matcher/store-session-creator.ts` - 登录选项管理

#### AI 匹配逻辑
- [x] 任务描述解析（提取门店名称、平台）
- [x] 门店匹配（精确匹配 → 别名匹配 → 模糊匹配）
- [x] 登录态匹配（根据门店 + 平台）
- [x] 多匹配时询问用户
- [x] 匹配失败时返回登录选项

**相关文件**：
- `src/main/store-matcher/store-matcher.ts` - `StoreMatcher` 类
- `src/main/store-matcher/store-session-creator.ts` - `StoreSessionCreator` 类

#### 一站式配置 UI
- [x] 左侧门店列表（带状态图标 🟢🟡🔴）
- [x] 右侧配置详情（平台配置面板）
- [x] 搜索功能（按名称、别名、品牌、城市）
- [x] 新建门店表单（含别名输入）
- [x] 平台配置对话框（本地登录 + 远程登录选项）
- [x] 一键配置全部平台
- [x] 批量导入/导出按钮

**相关文件**：
- `src/renderer/components/StoreSessionManager.tsx` - 主组件
- `src/renderer/styles/store-session-manager.css` - 样式
- `src/renderer/App.tsx` - 集成入口
- `src/renderer/components/ChatWindow.tsx` - `[STORES]` 按钮

#### 工具注册
- [x] 12 个新工具已注册到工具加载器
- [x] 工具名称常量已定义

**相关文件**：
- `src/main/tools/registry/tool-loader.ts` - 工具加载
- `src/main/tools/tool-names.ts` - 工具名称常量

### 8.1.2 待实现的功能 ⏳

#### 记忆架构
- [ ] 统一记忆注入（三层记忆）
- [ ] 记忆自动提取
- [ ] 记忆搜索（语义搜索）

#### 门店数据
- [ ] 门店数据表结构
- [ ] 门店数据查询工具
- [ ] 数据导入（从影刀接口）

#### 飞书交互
- [ ] 可更新的进度卡片
- [ ] 操作确认卡片交互流
- [ ] 卡片按钮回调处理

#### 权限管理（Phase 2）
- [ ] 公司 → 群组 → 员工权限模型
- [ ] 登录态权限绑定
- [ ] 权限检查中间件

#### 远程登录
- [ ] BrowserAct 登录流程集成
- [ ] 登录态自动保存
- [ ] 登录态过期检测

---

## 8.2 技术决策记录

### 8.2.1 数据库访问模式

**问题**：`ToolCreateOptions` 接口没有 `db` 属性，工具无法直接访问数据库。

**解决方案**：使用 `SystemConfigStore.getInstance().getDb()` 模式。

```typescript
// 错误方式
const db = options.db; // ❌ Property 'db' does not exist

// 正确方式
import { SystemConfigStore } from '../database/system-config-store';
const db = SystemConfigStore.getInstance().getDb(); // ✅
```

**影响范围**：
- `src/main/tools/store-management-tool.ts`
- `src/main/tools/store-session-tool.ts`
- `src/main/tools/store-import-tool.ts`
- `src/main/store-matcher/store-matcher.ts`

### 8.2.2 门店匹配策略

**优先级**：
1. 精确匹配（名称完全一致）
2. 别名匹配（别名列表中包含）
3. 模糊匹配（名称包含查询词）

**代码位置**：`src/main/store-matcher/store-matcher.ts`

### 8.2.3 浏览器自动化方案

**选择**：browseract + GPT-5.5

**理由**：
- browseract 功能强大，支持复杂页面操作
- GPT-5.5 模型能力强，犯错概率低
- 不需要 fallback 机制

**集成方式**：
- 本地登录：用户粘贴 Cookie JSON
- 远程登录：通过 BrowserAct 打开登录页面，用户手动登录，系统保存登录态

---

## 9. 数据结构参考

从影刀导出的数据格式（CSV）：

### 门店数据

```
日期, 门店名称, 门店id, 省份, 城市, 区县, 营业收入, 商品原价, 包装费,
顾客配送费, 补贴及支出, 商家活动支出, 优惠前总额, 顾客实付, 有效订单,
实付单均价, 曝光人数, 入店人数, 入店转化率, 下单转化率, 店铺分,
综合体验分, 商品质量分, 服务体验分, ...
```

### 商品数据

```
日期, 商品名, 城市, 门店名称, 门店id, 商品销量, 销量占比,
商品销售额, 销售额占比, 商品好评数, 商品差评数, ...
```

### 订单数据

```
日期, 订单编号, 城市, 门店名称, 门店id, 下单时间, 完成时间,
配送时长, 订单状态, 商品信息, 活动信息, 订单实付, 商品原价,
配送费, 包装费, 活动补贴, 商家活动支出, ...
```

### 评价数据

```
日期, 城市, 门店名称, 门店id, 评价时间, 总体评分, 口味评分,
包装评分, 配送满意度, 评价内容, 用户名称, 商家回复, ...
```

---

## 10. 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + Vite |
| 桌面端 | Electron 28+ |
| 后端 | Express + WebSocket |
| 数据库 | SQLite（主存储）+ mem0（向量记忆） |
| AI 引擎 | @mariozechner/pi-agent-core |
| 浏览器自动化 | agent-browser (Playwright) + browser-act |
| 外部平台 | 飞书 SDK + 微信 + 企业微信 |
| 包管理 | pnpm |
