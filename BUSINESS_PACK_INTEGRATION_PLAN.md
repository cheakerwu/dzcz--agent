# Business Pack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Local Agent Terminal support business capability packs so domain capabilities such as merchant operations can be developed independently and plugged into the existing framework.

**Architecture:** Keep Local Agent Terminal as the core runtime for sessions, tabs, tools, skills, memory, scheduled tasks, connectors, and UI. Add a thin Business Pack layer that discovers pack manifests, registers pack tools, exposes pack skills through the existing Skill system, seeds scheduled tasks, and keeps domain state outside the core runtime.

**Tech Stack:** Electron, TypeScript, Vite, Express, SQLite, `@mariozechner/pi-agent-core`, TypeBox, existing Local Agent Terminal `ToolPlugin`, existing Local Agent Terminal Skills, existing scheduled task system.

---

## 1. Current Codebase Read

This source tree already has most of the right core framework. The key extension points are:

| Area | Existing files | Current status | Business pack implication |
|---|---|---|---|
| Session / Tab runtime | `src/main/gateway.ts`, `src/main/gateway-tab.ts`, `src/main/session/*` | Framework manages per-Tab sessions and persisted JSONL histories. | Keep this in core. Packs should not own user chat sessions. |
| Agent runtime | `src/main/agent-runtime/*` | Runtime creates tools per workspace and session. | Business tools can run inside the same runtime once registered. |
| Tool interface | `src/main/tools/registry/tool-interface.ts` | `ToolPlugin` is already a clean plugin interface. | Reuse it for pack tools. |
| Tool loading | `src/main/tools/registry/tool-loader.ts` | Built-in tools are hard-coded imports. | This is the main place that prevents true plug-in behavior. |
| Tool registry | `src/main/tools/registry/tool-registry.ts` | Has historical dynamic loading support through `loadFromDirectory()`, but loader does not use it for business packs. | Reuse or simplify this rather than inventing a parallel registry. |
| Tool names | `src/main/tools/tool-names.ts` | Built-in names are centralized constants. | Pack tools should not require editing this file; they should use names from manifest/tool modules. |
| Skills | `src/main/tools/skill-manager/*`, `src/main/config/skill-paths.ts` | Skills are already filesystem-discovered from multiple configured directories. | Business packs can expose `skills/` with minimal framework changes. |
| Prompt assembly | `src/main/prompts/system-prompt.ts`, `src/main/prompts/context-loader.ts` | Enabled Skills are listed in system prompt; full Skill content is loaded by the existing Skill workflow. | Do not inject large business prompts globally. Use Skills and Tab work prompts. |
| Scheduled tasks | `src/main/scheduled-tasks/*`, `src/main/tools/scheduled-task-tool.ts` | Scheduled tasks are persisted and executed in task-specific Tabs. | Packs can seed default schedules, but user-owned tasks remain in core scheduler. |
| Config / secrets | `src/main/database/system-config-store.ts`, `src/main/tools/api-tool.ts`, Skill `.env` | Global config exists; Skill env exists; tool configs are mostly bespoke. | Packs need a small config convention. Avoid scattering domain config in global `.env`. |
| External API | `src/server/routes/external.ts`, `docs/external-api.md` | External systems can message or command a named Tab synchronously. | Pack services can call Local Agent Terminal, and Local Agent Terminal tools can call pack services. |
| Connectors | `src/main/connectors/*` | Feishu, WeChat, WeCom, smart-kf are framework connectors. | Keep connectors generic; business packs should receive normalized user/chat/task context. |

## 2. Main Conclusion

Local Agent Terminal does not need a business rewrite. It is already a suitable core framework.

However, it is not yet a clean "USB-style" business pack platform because:

1. Tool loading is hard-coded in `src/main/tools/registry/tool-loader.ts`.
2. Tool names for built-in tools are centralized in `src/main/tools/tool-names.ts`, which is fine for core tools but should not be required for pack tools.
3. Skills are discoverable, but there is no first-class "pack owns these skills" metadata.
4. Scheduled tasks are dynamic, but there is no default schedule seeding by pack.
5. Config and secrets exist, but there is no pack-scoped config shape.
6. Permissions are currently mostly tool-level enable/disable, not role + pack + action level.
7. There is no pack install/list/enable/disable UI/API yet.

The first technical goal should be a thin `business-packs` layer, not a refactor of the Agent runtime.

## 3. Business Pack Boundary

Use this rule:

```text
Local Agent Terminal core owns:
- user sessions
- tabs
- agent runtime
- generic tools
- generic browser/file/document/web tools
- memory mechanics
- scheduled task engine
- connectors
- UI shell
- generic tool enable/disable
- external API

Business packs own:
- domain tools
- domain skills
- domain prompts
- domain schemas
- domain schedules
- domain state
- domain account/session semantics
- domain risk policy
- domain docs
```

For the merchant operations example:

```text
Local Agent Terminal core should not know:
- 美团
- 饿了么
- 江湖饭焗
- 门店账号
- 菜品动销
- 外卖后台 Recipe

The merchant pack should know:
- platform/store/account binding
- merchant metrics schema
- diagnosis workflow
- report templates
- browser execution recipes
- login-state checks
- operation risk levels
```

## 4. Recommended Pack Shape

Use a file layout like this:

```text
business-packs/
  merchant-ops/
    manifest.json
    README.md
    prompts/
      system.md
      diagnosis-agent.md
    skills/
      merchant-daily-report/
        SKILL.md
      merchant-store-diagnosis/
        SKILL.md
      merchant-change-phone/
        SKILL.md
    tools/
      merchant-api-tool.ts
      merchant-account-tool.ts
    schedules/
      daily-alerts.json
      daily-report.json
    schemas/
      store.schema.json
      account.schema.json
      metric.schema.json
    examples/
      feishu-commands.md
```

For a Python-backed pack, keep Local Agent Terminal-side TypeScript tools thin:

```text
Local Agent Terminal Agent
  -> merchant_* ToolPlugin
  -> HTTP call to merchant_automation service
  -> Python/FastAPI/SQLite/BrowserAct/business logic
```

That keeps Node/Electron framework code small and lets domain logic evolve independently.

## 5. Minimal Manifest Contract

Start with this manifest shape:

```json
{
  "name": "merchant-ops",
  "displayName": "外卖运营能力包",
  "version": "0.1.0",
  "description": "外卖商家运营数据、诊断、报表和后台操作能力",
  "entry": {
    "tools": [
      "tools/merchant-api-tool.js",
      "tools/merchant-account-tool.js"
    ]
  },
  "skills": [
    "skills/merchant-daily-report",
    "skills/merchant-store-diagnosis",
    "skills/merchant-change-phone"
  ],
  "schedules": [
    "schedules/daily-alerts.json",
    "schedules/daily-report.json"
  ],
  "permissions": [
    "merchant.metrics.read",
    "merchant.report.write",
    "merchant.account.read",
    "merchant.browser.execute"
  ],
  "config": {
    "MERCHANT_API_BASE_URL": {
      "required": true,
      "secret": false,
      "description": "Merchant service base URL, for example http://127.0.0.1:8010"
    },
    "MERCHANT_API_TOKEN": {
      "required": false,
      "secret": true,
      "description": "Shared token used by the merchant service"
    }
  }
}
```

Important: use compiled `.js` entries at runtime. TypeScript source can live in the pack during development, but Electron production should load JavaScript.

## 6. Important Design Notes

### 6.1 Tools Should Be Real Code, Skills Should Be Operating Manuals

Do not put stateful business logic only inside `SKILL.md`.

Good split:

```text
Tool:
- query metrics
- resolve account
- check login state
- execute recipe
- generate report file
- write audit log

Skill:
- when to call which tool
- what order to follow
- what information to ask from user
- what safety checks to perform
- how to summarize the result
```

### 6.2 Domain Login State Is Not Core Session State

Keep these separate:

```text
Local Agent Terminal session:
- user/chat/tab conversation state
- memory
- task history

Merchant account session:
- platform
- store
- account alias
- browser profile id
- login status
- last verified time
- lock state
```

Merchant account/session state belongs to the merchant pack or merchant backend service.

### 6.3 Avoid Global Prompt Bloat

`src/main/prompts/system-prompt.ts` currently lists enabled Skills in the prompt. That is enough for routing. Do not paste all merchant SOP content into the global system prompt.

Use:

```text
Skill descriptions for discovery
SKILL.md for workflow
pack tools for real actions
memory for team/store preferences
Tab work prompt for role specialization
```

### 6.4 Keep Browser Automation Behind Domain Tools

The built-in `browser` tool is generic. Business actions such as "修改门店电话" should be wrapped by domain tools or a domain service:

```text
merchant_execute_recipe({
  platform: "meituan",
  storeAlias: "江湖饭焗-天河店",
  recipe: "change_phone",
  params: { phone: "13800138000" }
})
```

Do not let the main Agent freely improvise every merchant backend click path when a repeatable Recipe exists.

### 6.5 Permissions Need Pack-Level Vocabulary

The existing disabled-tools table can hide entire tools, but business usage needs finer permission names:

```text
merchant.metrics.read
merchant.report.write
merchant.browser.execute
merchant.account.manage
merchant.recipe.high_risk_execute
```

For a 10-person team, this can start as a JSON config file before building a full UI.

### 6.6 Scheduled Tasks Should Be Seeded, Not Hard-Coded

The core scheduler should remain generic. A pack can provide default schedule definitions:

```json
{
  "name": "merchant-daily-alerts",
  "description": "每天早上 9 点扫描昨日门店异常并发送飞书摘要",
  "schedule": {
    "type": "cron",
    "cronExpr": "0 9 * * *",
    "timezone": "Asia/Shanghai"
  },
  "enabledByDefault": false
}
```

Install should import this as a disabled task or show it for one-click enablement.

## 7. Phased Implementation Plan

### Task 1: Add Business Pack Types

**Files:**
- Create: `src/main/business-packs/types.ts`

- [ ] **Step 1: Create pack type definitions**

```typescript
export interface BusinessPackConfigField {
  required: boolean;
  secret: boolean;
  description: string;
}

export interface BusinessPackManifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  entry?: {
    tools?: string[];
  };
  skills?: string[];
  schedules?: string[];
  permissions?: string[];
  config?: Record<string, BusinessPackConfigField>;
}

export interface BusinessPack {
  rootDir: string;
  manifestPath: string;
  manifest: BusinessPackManifest;
  enabled: boolean;
}
```

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from src/main/business-packs/types.ts
```

### Task 2: Add Pack Path Resolution

**Files:**
- Create: `src/main/business-packs/pack-paths.ts`

- [ ] **Step 1: Implement default pack directories**

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { expandUserPath } from '../../shared/utils/path-utils';

export function getDefaultBusinessPackDirs(workspaceDir?: string): string[] {
  const dirs = [
    join(homedir(), '.deepbot', 'business-packs'),
  ];

  if (workspaceDir) {
    dirs.push(join(workspaceDir, '.deepbot', 'business-packs'));
  }

  return dirs.map(expandUserPath);
}

export function ensureBusinessPackDirs(workspaceDir?: string): string[] {
  const dirs = getDefaultBusinessPackDirs(workspaceDir);
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  return dirs;
}
```

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from src/main/business-packs/pack-paths.ts
```

### Task 3: Add Manifest Loader

**Files:**
- Create: `src/main/business-packs/pack-loader.ts`

- [ ] **Step 1: Implement manifest discovery**

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { safeJsonParse } from '../../shared/utils/json-utils';
import type { BusinessPack, BusinessPackManifest } from './types';
import { ensureBusinessPackDirs } from './pack-paths';

function isValidManifest(value: any): value is BusinessPackManifest {
  return Boolean(
    value &&
    typeof value.name === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.version === 'string' &&
    typeof value.description === 'string'
  );
}

export function discoverBusinessPacks(workspaceDir?: string): BusinessPack[] {
  const dirs = ensureBusinessPackDirs(workspaceDir);
  const packs: BusinessPack[] = [];

  for (const baseDir of dirs) {
    if (!existsSync(baseDir)) continue;

    for (const entry of readdirSync(baseDir)) {
      const rootDir = join(baseDir, entry);
      if (!statSync(rootDir).isDirectory()) continue;

      const manifestPath = join(rootDir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;

      const manifest = safeJsonParse<BusinessPackManifest>(
        readFileSync(manifestPath, 'utf-8'),
        null as any
      );

      if (!isValidManifest(manifest)) {
        console.warn(`[BusinessPack] Invalid manifest: ${manifestPath}`);
        continue;
      }

      packs.push({
        rootDir,
        manifestPath,
        manifest,
        enabled: true,
      });
    }
  }

  return packs;
}
```

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from src/main/business-packs/pack-loader.ts
```

### Task 4: Load Pack Tools Without Editing Core Tool Names

**Files:**
- Create: `src/main/business-packs/tool-loader.ts`
- Modify: `src/main/tools/registry/tool-loader.ts`

- [ ] **Step 1: Create pack tool loader**

```typescript
import { join, resolve } from 'node:path';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolCreateOptions, ToolPlugin } from '../tools/registry/tool-interface';
import { discoverBusinessPacks } from './pack-loader';

async function resolvePluginTools(
  result: AgentTool | AgentTool[] | Promise<AgentTool | AgentTool[]>
): Promise<AgentTool[]> {
  const resolved = result instanceof Promise ? await result : result;
  return Array.isArray(resolved) ? resolved : [resolved];
}

function getPluginFromModule(module: any): ToolPlugin | null {
  return module.default || module.plugin || module.toolPlugin || null;
}

export async function loadBusinessPackTools(options: ToolCreateOptions): Promise<AgentTool[]> {
  const packs = discoverBusinessPacks(options.workspaceDir);
  const tools: AgentTool[] = [];

  for (const pack of packs) {
    const toolEntries = pack.manifest.entry?.tools || [];

    for (const relativeEntry of toolEntries) {
      const entryPath = resolve(join(pack.rootDir, relativeEntry));
      const module = await import(entryPath);
      const plugin = getPluginFromModule(module);

      if (!plugin?.metadata || !plugin.create) {
        console.warn(`[BusinessPack] Invalid tool plugin: ${entryPath}`);
        continue;
      }

      const created = await resolvePluginTools(plugin.create(options));
      tools.push(...created);
      console.info(`[BusinessPack] Loaded ${created.length} tool(s) from ${pack.manifest.name}`);
    }
  }

  return tools;
}
```

- [ ] **Step 2: Modify the built-in tool loader to append pack tools**

In `src/main/tools/registry/tool-loader.ts`, import:

```typescript
import { loadBusinessPackTools } from '../../business-packs/tool-loader';
```

At the end of `private async loadTools(configStore?: any): Promise<AgentTool[]>`, after built-in tools are pushed and before the `catch` closes, add:

```typescript
      tools.push(...await loadBusinessPackTools(pluginOpts));
```

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from pack tool loading.
```

### Task 5: Expose Pack Skills Through Existing Skill Paths

**Files:**
- Create: `src/main/business-packs/skill-paths.ts`
- Modify: `src/main/config/skill-paths.ts`

- [ ] **Step 1: Create helper that returns pack skill parent directories**

```typescript
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { discoverBusinessPacks } from './pack-loader';

export function getBusinessPackSkillParentPaths(workspaceDir?: string): string[] {
  const paths: string[] = [];

  for (const pack of discoverBusinessPacks(workspaceDir)) {
    const skillParent = join(pack.rootDir, 'skills');
    if (existsSync(skillParent)) {
      paths.push(skillParent);
    }
  }

  return paths;
}
```

- [ ] **Step 2: Use the parent directory strategy**

The current scanner in `src/main/tools/skill-manager/manage.ts` expects each configured Skill path to contain child folders, and each child folder must contain `SKILL.md`. Therefore expose this parent folder:

```text
business-packs/merchant-ops/skills/
```

- [ ] **Step 3: Wire pack skill parent directories into `getAllSkillPaths()`**

In `src/main/config/skill-paths.ts`, import:

```typescript
import { getBusinessPackSkillParentPaths } from '../business-packs/skill-paths';
```

Then append pack skill parent paths to the configured paths:

```typescript
const configuredPaths = settings.skillDirs.map(expandUserPath);
return [...configuredPaths, ...getBusinessPackSkillParentPaths(settings.workspaceDir)];
```

- [ ] **Step 4: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from Skill path integration.
```

### Task 6: Seed Pack Scheduled Tasks

**Files:**
- Create: `src/main/business-packs/schedule-loader.ts`
- Create: `src/main/business-packs/schedule-seeder.ts`
- Modify: `src/main/tools/scheduled-task-tool.ts`

- [ ] **Step 1: Implement schedule definition loader**

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeJsonParse } from '../../shared/utils/json-utils';
import type { TaskCreateInput } from '../scheduled-tasks/types';
import { discoverBusinessPacks } from './pack-loader';

export interface PackScheduleDefinition extends TaskCreateInput {
  enabledByDefault?: boolean;
}

export function loadPackScheduleDefinitions(workspaceDir?: string): PackScheduleDefinition[] {
  const definitions: PackScheduleDefinition[] = [];

  for (const pack of discoverBusinessPacks(workspaceDir)) {
    for (const relativePath of pack.manifest.schedules || []) {
      const schedulePath = join(pack.rootDir, relativePath);
      if (!existsSync(schedulePath)) continue;

      const definition = safeJsonParse<PackScheduleDefinition>(
        readFileSync(schedulePath, 'utf-8'),
        null as any
      );

      if (definition?.name && definition.description && definition.schedule) {
        definitions.push(definition);
      }
    }
  }

  return definitions;
}
```

- [ ] **Step 2: Seed tasks as disabled by default**

Create `src/main/business-packs/schedule-seeder.ts`. It creates a task only if the same `name` does not exist. For first release, it sets `enabled` false immediately after creating unless `enabledByDefault` is true.

```typescript
import { TaskStore } from '../scheduled-tasks/store';
import { loadPackScheduleDefinitions } from './schedule-loader';

export function seedBusinessPackSchedules(workspaceDir?: string): void {
  const store = TaskStore.getInstance();
  const existing = new Set(store.list().map(task => task.name));

  for (const definition of loadPackScheduleDefinitions(workspaceDir)) {
    if (existing.has(definition.name)) continue;

    const task = store.create({
      name: definition.name,
      description: definition.description,
      schedule: definition.schedule,
    });

    if (!definition.enabledByDefault) {
      store.update(task.id, { enabled: false });
    }
  }
}
```

- [ ] **Step 3: Call schedule seeding when scheduled task gateway is initialized**

In `src/main/tools/scheduled-task-tool.ts`, inside `setGatewayInstance(gateway: Gateway)`, after `gatewayInstance = gateway;`, add:

```typescript
  try {
    const { SystemConfigStore } = require('../database/system-config-store');
    const { seedBusinessPackSchedules } = require('../business-packs/schedule-seeder');
    const settings = SystemConfigStore.getInstance().getWorkspaceSettings();
    seedBusinessPackSchedules(settings.workspaceDir);
  } catch (error) {
    console.warn('[BusinessPack] Failed to seed schedules:', error);
  }
```

- [ ] **Step 4: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from schedule seeding.
```

### Task 7: Add Pack Config Convention

**Files:**
- Create: `src/main/business-packs/config.ts`

- [ ] **Step 1: Add config file location helper**

```typescript
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { safeJsonParse, safeJsonStringify } from '../../shared/utils/json-utils';

export function getBusinessPackConfigPath(packName: string): string {
  return join(homedir(), '.deepbot', 'business-packs', packName, 'config.json');
}

export function readBusinessPackConfig(packName: string): Record<string, any> {
  const configPath = getBusinessPackConfigPath(packName);
  if (!existsSync(configPath)) return {};
  return safeJsonParse<Record<string, any>>(readFileSync(configPath, 'utf-8'), {});
}

export function writeBusinessPackConfig(packName: string, config: Record<string, any>): void {
  const configPath = getBusinessPackConfigPath(packName);
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, safeJsonStringify(config, true), 'utf-8');
}
```

- [ ] **Step 2: Use config in pack tools**

Pack tools should read config using:

```typescript
const config = readBusinessPackConfig('merchant-ops');
const baseUrl = config.MERCHANT_API_BASE_URL;
```

- [ ] **Step 3: Keep secrets local**

Store secret values in the same pack config file for MVP. Move to OS keychain later only when needed.

- [ ] **Step 4: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from pack config helpers.
```

### Task 8: Create First Merchant Pack Skeleton

**Files:**
- Create: `business-packs/merchant-ops/manifest.json`
- Create: `business-packs/merchant-ops/README.md`
- Create: `business-packs/merchant-ops/skills/merchant-daily-report/SKILL.md`
- Create: `business-packs/merchant-ops/skills/merchant-store-diagnosis/SKILL.md`
- Create: `business-packs/merchant-ops/skills/merchant-change-phone/SKILL.md`
- Create: `business-packs/merchant-ops/schedules/daily-alerts.json`

- [ ] **Step 1: Add manifest**

```json
{
  "name": "merchant-ops",
  "displayName": "外卖运营能力包",
  "version": "0.1.0",
  "description": "外卖商家运营数据、诊断、报表和后台操作能力",
  "entry": {
    "tools": []
  },
  "skills": [
    "skills/merchant-daily-report",
    "skills/merchant-store-diagnosis",
    "skills/merchant-change-phone"
  ],
  "schedules": [
    "schedules/daily-alerts.json"
  ],
  "permissions": [
    "merchant.metrics.read",
    "merchant.report.write",
    "merchant.account.read",
    "merchant.browser.execute"
  ],
  "config": {
    "MERCHANT_API_BASE_URL": {
      "required": true,
      "secret": false,
      "description": "Merchant service base URL"
    }
  }
}
```

- [ ] **Step 2: Add daily report Skill**

```markdown
---
name: merchant-daily-report
description: 生成外卖门店日报，适用于查询昨日核心指标、环比波动、异常说明和今日运营动作。
version: 0.1.0
author: Local Agent Business Pack
tags: [merchant, report, daily]
---

# 外卖门店日报 Skill

使用场景：用户要求生成门店日报、品牌日报、昨日复盘、今日待办时使用。

流程：
1. 明确门店、品牌和日期范围；用户未说明日期时默认昨日。
2. 调用外卖运营数据工具查询曝光、入店、下单、成交额、订单量、客单价、转化率、差评和退款。
3. 对比前一日和近 7 日均值，标出明显上升或下降项。
4. 输出四段：核心结论、异常指标、可能原因、今日动作。
5. 如果用户要求发送到飞书，调用连接器发送消息或飞书文档工具。
```

- [ ] **Step 3: Add store diagnosis Skill**

```markdown
---
name: merchant-store-diagnosis
description: 诊断外卖门店经营下滑原因，适用于单量、营收、曝光、入店、转化、差评异常分析。
version: 0.1.0
author: Local Agent Business Pack
tags: [merchant, diagnosis, growth]
---

# 外卖门店诊断 Skill

使用场景：用户询问为什么单量下降、营收下降、转化变差、曝光不足、差评升高时使用。

流程：
1. 确认门店、平台和时间范围。
2. 查询核心漏斗：曝光、入店、下单、支付、退款、差评。
3. 将异常定位到流量层、转化层、商品层、履约层或评价层。
4. 检索团队 SOP 或历史案例。
5. 输出诊断结论、证据、优先级动作和需要人工确认的信息。
```

- [ ] **Step 4: Add change phone Skill**

```markdown
---
name: merchant-change-phone
description: 修改外卖平台门店联系电话，适用于用户要求更新门店电话并需要后台执行和截图取证。
version: 0.1.0
author: Local Agent Business Pack
tags: [merchant, browser, execution]
---

# 修改门店电话 Skill

使用场景：用户要求修改美团、饿了么、抖音来客等平台门店联系电话时使用。

流程：
1. 确认平台、门店、目标电话号码。
2. 调用账号解析工具获取门店账号和浏览器 profile。
3. 检查登录态；登录失效时提示人工登录。
4. 调用执行工具运行 `change_phone` Recipe。
5. 执行前后截图取证。
6. 向用户返回操作结果、截图路径、失败原因或待人工处理事项。
```

- [ ] **Step 5: Add disabled default alert schedule**

```json
{
  "name": "merchant-daily-alerts",
  "description": "扫描昨日外卖门店核心指标，发现异常并生成飞书摘要",
  "schedule": {
    "type": "cron",
    "cronExpr": "0 9 * * *",
    "timezone": "Asia/Shanghai"
  },
  "enabledByDefault": false
}
```

- [ ] **Step 6: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
The static skeleton does not break TypeScript compilation.
```

### Task 9: Add Merchant API Tool

**Files:**
- Create: `business-packs/merchant-ops/tools/merchant-api-tool.ts`
- Update: `business-packs/merchant-ops/manifest.json`

- [ ] **Step 1: Add tool names inside the pack tool file**

```typescript
const MERCHANT_TOOL_NAMES = {
  QUERY_METRICS: 'merchant_query_metrics',
  SCAN_ALERTS: 'merchant_scan_alerts',
  DIAGNOSE_STORE: 'merchant_diagnose_store',
  EXECUTE_RECIPE: 'merchant_execute_recipe',
} as const;
```

- [ ] **Step 2: Implement a thin HTTP client tool plugin**

```typescript
import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from '../../../src/main/tools/registry/tool-interface';
import { readBusinessPackConfig } from '../../../src/main/business-packs/config';

async function callMerchantApi(path: string, body: Record<string, any>) {
  const config = readBusinessPackConfig('merchant-ops');
  const baseUrl = config.MERCHANT_API_BASE_URL;
  if (!baseUrl) {
    throw new Error('MERCHANT_API_BASE_URL is not configured');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.MERCHANT_API_TOKEN ? { Authorization: `Bearer ${config.MERCHANT_API_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Merchant API failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export const merchantApiToolPlugin: ToolPlugin = {
  metadata: {
    id: 'merchant-api',
    name: '外卖运营 API',
    description: '查询外卖运营数据、扫描异常、诊断门店和执行标准后台 Recipe',
    version: '0.1.0',
    author: 'Local Agent Business Pack',
    category: 'custom',
    tags: ['merchant', 'operations'],
  },
  create: (_options: ToolCreateOptions) => [
    {
      name: MERCHANT_TOOL_NAMES.QUERY_METRICS,
      label: '查询外卖数据',
      description: '查询指定平台、门店、日期范围的外卖运营指标',
      parameters: Type.Object({
        platform: Type.String({ description: '平台，例如 meituan、eleme、douyin' }),
        storeAlias: Type.String({ description: '门店别名' }),
        dateRange: Type.String({ description: '日期范围，例如 yesterday、last_7_days、2026-06-01..2026-06-07' }),
      }),
      execute: async (_toolCallId, params) => {
        const result = await callMerchantApi('/query_metrics', params as any);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    },
    {
      name: MERCHANT_TOOL_NAMES.EXECUTE_RECIPE,
      label: '执行外卖后台操作',
      description: '执行外卖后台标准 Recipe，例如修改电话、修改营业时间、上传图片。高风险动作执行前必须获得用户明确确认。',
      parameters: Type.Object({
        platform: Type.String({ description: '平台，例如 meituan、eleme、douyin' }),
        storeAlias: Type.String({ description: '门店别名' }),
        recipe: Type.String({ description: 'Recipe 名称，例如 change_phone' }),
        params: Type.Record(Type.String(), Type.Any(), { description: 'Recipe 参数' }),
        confirmed: Type.Boolean({ description: '用户是否已明确确认执行' }),
      }),
      execute: async (_toolCallId, params) => {
        if (!(params as any).confirmed) {
          throw new Error('用户尚未确认执行后台操作');
        }
        const result = await callMerchantApi('/execute_recipe', params as any);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    },
  ],
};

export default merchantApiToolPlugin;
```

- [ ] **Step 3: Add compiled tool entry to manifest after build setup exists**

```json
"entry": {
  "tools": [
    "dist/tools/merchant-api-tool.js"
  ]
}
```

- [ ] **Step 4: Run TypeScript check**

Run:

```bash
pnpm run type-check
```

Expected:

```text
No TypeScript errors from merchant API tool once pack build paths are configured.
```

### Task 10: Add Pack Management API

**Files:**
- Create: `src/server/routes/business-packs.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/gateway-adapter.ts`

- [ ] **Step 1: Add route handlers**

```typescript
import { Router } from 'express';
import { discoverBusinessPacks } from '../../main/business-packs/pack-loader';

export function createBusinessPacksRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const packs = discoverBusinessPacks();
    res.json({
      success: true,
      packs: packs.map(pack => ({
        name: pack.manifest.name,
        displayName: pack.manifest.displayName,
        version: pack.manifest.version,
        description: pack.manifest.description,
        enabled: pack.enabled,
        permissions: pack.manifest.permissions || [],
        config: pack.manifest.config || {},
      })),
    });
  });

  return router;
}
```

- [ ] **Step 2: Mount the route**

In `src/server/index.ts`, mount:

```typescript
app.use('/api/business-packs', createBusinessPacksRouter());
```

- [ ] **Step 3: Run server type check**

Run:

```bash
pnpm run type-check:server
```

Expected:

```text
No TypeScript errors from server route integration.
```

## 8. First Usable MVP Scope

For a 10-person internal team, do not start with all agents from the spreadsheet.

Start with:

```text
1. Unified Local Agent Terminal/Feishu entry
2. merchant-daily-report Skill
3. merchant-store-diagnosis Skill
4. merchant-change-phone Skill
5. merchant_query_metrics tool
6. merchant_execute_recipe tool
7. one disabled default daily-alert schedule
```

This gives a complete loop:

```text
ask question -> query data -> diagnose -> suggest action -> confirm -> execute -> record result
```

Then add:

```text
merchant_menu_analysis
merchant_content_plan
merchant_proposal
merchant_algorithm_review
```

## 9. Risks To Watch

| Risk | Why it matters | Mitigation |
|---|---|---|
| Dynamic import in packaged Electron | Runtime `.js` files outside ASAR may need path handling. | Use user data directory or workspace `.local-agent/business-packs`; document that pack tools must be compiled JS. |
| Pack tool path security | Arbitrary local JS execution is powerful. | Only load packs from configured trusted directories; require manual install/enable. |
| Prompt bloat | Many business Skills can make prompts noisy. | Keep system prompt to Skill names/descriptions; load detailed instructions only when used. |
| Tool namespace collision | Pack tool name can collide with core tool name. | Enforce prefix naming such as `merchant_*`. |
| Business state leaking into core | Makes future packs harder. | Put account/store/session state in pack service or pack database. |
| High-risk browser actions | State-changing actions can damage real accounts. | Require `confirmed: true`, screenshots, audit logs, and per-action risk levels. |
| Scheduled task duplication | Pack install could create repeated tasks. | Seed by stable task name and skip if it already exists. |
| Permissions too coarse | Current disabled-tools config is not enough for operations. | Add pack permission vocabulary first, UI later. |

## 10. Verification Checklist

Run these after implementing the pack layer:

```bash
pnpm run type-check
pnpm run type-check:server
pnpm run build
```

Manual checks:

```text
1. Put merchant-ops pack under ~/.local-agent/business-packs/merchant-ops.
2. Start Local Agent Terminal.
3. Confirm logs show pack discovery.
4. Ask Skill Manager to list installed Skills.
5. Confirm merchant Skills appear.
6. Ask Agent what merchant tools are available.
7. Configure MERCHANT_API_BASE_URL.
8. Ask: "生成江湖饭焗昨天的门店日报".
9. Confirm Agent calls merchant_query_metrics.
10. Ask: "把江湖饭焗美团门店电话改成 13800138000".
11. Confirm Agent asks for explicit confirmation before merchant_execute_recipe.
```

## 11. Recommended Next Move

Do the work in this order:

```text
1. Add pack discovery and manifest loader.
2. Add dynamic pack tool loading.
3. Add pack skill directory discovery.
4. Add merchant-ops skeleton with three Skills.
5. Add merchant API tool as a thin HTTP wrapper.
6. Add schedule seeding.
7. Add pack list API/UI only after the command-line/log flow works.
```

The core idea is stable:

```text
Local Agent Terminal = framework and runtime
Business Pack = domain capability bundle
Merchant Service = domain execution backend
```

Keep that boundary, and the framework can stay mostly unchanged while business capabilities grow pack by pack.
