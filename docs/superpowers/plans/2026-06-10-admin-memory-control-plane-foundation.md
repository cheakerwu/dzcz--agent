# Admin Memory Control Plane Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable DianBot admin control plane that manages stores, employees, Feishu conversations, governed memories, browser login-state references, audit events, and scoped prompt memory for restaurant operations.

**Architecture:** SQLite is the authority for business relationships and memory governance. mem0 is added behind an optional provider adapter for searchable long-term memory sync, while Markdown memory remains compatible as fallback. Electron uses IPC and Web mode uses Express against the same service layer; React gets a full-screen admin console separate from system settings.

**Tech Stack:** TypeScript, React, Electron IPC, Express, Node 22 `node:test`, SQLite through the existing adapter, pnpm, optional `mem0ai` SDK.

---

## File Structure

- Create `src/types/admin-control-plane.ts`: shared request, entity, status, response, and prompt-context types.
- Create `src/main/admin-control-plane/schema.ts`: SQLite DDL and table indexes.
- Create `src/main/admin-control-plane/service.ts`: CRUD, assignment, binding, memory governance, browser vault, prompt-context, and audit logic.
- Create `src/main/admin-control-plane/mem0-provider.ts`: optional mem0 sync adapter with safe disabled-state behavior.
- Create `src/main/admin-control-plane/prompt-context.ts`: session-to-conversation resolution and compact prompt rendering.
- Modify `src/main/database/system-config-store.ts`: initialize admin tables in the existing database lifecycle.
- Create `src/main/ipc/admin-control-plane-handler.ts`: generic IPC action router.
- Modify `src/main/index.ts`: register the admin IPC handler.
- Modify `src/main/preload.ts`: expose `deepbot.adminControlPlane`.
- Modify `src/types/ipc.ts`: add `ADMIN_CONTROL_PLANE_REQUEST`.
- Modify `src/types/window.d.ts`: add renderer type for `adminControlPlane`.
- Create `src/server/routes/admin-control-plane.ts`: generic Web API action router.
- Modify `src/server/index.ts`: mount `/api/admin-control-plane`.
- Modify `src/renderer/api/index.ts`: add admin control-plane client methods.
- Create `src/renderer/components/AdminConsole.tsx`: full-screen admin console workspace.
- Create `src/renderer/styles/admin-console.css`: restrained operations-console styling.
- Modify `src/renderer/App.tsx`: open and close the admin console.
- Modify `src/renderer/components/ChatWindow.tsx`: add admin console toolbar button.
- Modify `src/main/prompts/system-prompt.ts`: inject scoped governed memory context after the legacy core memory block.
- Create `scripts/admin-control-plane-service.test.mjs`: service-level Node tests against compiled JS and a temp SQLite DB.
- Create `scripts/admin-control-plane-prompt.test.mjs`: prompt-context tests proving browser secrets are excluded.
- Modify `package.json`: add `test:admin-memory` script and `mem0ai` dependency.

---

### Task 1: RED Service Test Harness

**Files:**
- Create: `scripts/admin-control-plane-service.test.mjs`
- Create: `scripts/admin-control-plane-prompt.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the service test script**

Add this script entry:

```json
"test:admin-memory": "node scripts/admin-control-plane-service.test.mjs && node scripts/admin-control-plane-prompt.test.mjs"
```

- [ ] **Step 2: Write the failing service behavior test**

Create `scripts/admin-control-plane-service.test.mjs` that builds the main process, opens a temp SQLite database, creates one store, one employee, one Feishu group, one store assignment, one conversation binding, one active memory item, and one browser profile. Assert the prompt context includes the store, memory, and browser profile label, excludes the browser `storageStateRef`, and offboarding creates an `employee.offboarded` audit event.

The test must import:

```js
const { default: Database } = require('../dist-electron/shared/utils/sqlite-adapter.js');
const { AdminControlPlaneService } = require('../dist-electron/main/admin-control-plane/service.js');
```

The central assertions must be:

```js
assert.match(context, /人民广场店/);
assert.match(context, /午高峰需要提前补打包袋/);
assert.match(context, /人民广场美团主账号/);
assert.doesNotMatch(context, /cookies\.json/);
assert.equal(dashboard.counts.activeEmployees, 0);
assert.ok(dashboard.recentAuditEvents.some((event) => event.action === 'employee.offboarded'));
```

- [ ] **Step 3: Write the failing prompt safety test**

Create `scripts/admin-control-plane-prompt.test.mjs` that creates one active memory, one archived memory, and one browser profile whose `storageStateRef` contains `token=abc123`. Assert the prompt context includes only the active memory and does not include the archived content or token string.

The central assertions must be:

```js
assert.match(context, /万达店周三主推套餐 A/);
assert.doesNotMatch(context, /归档记忆/);
assert.doesNotMatch(context, /token=abc123/);
```

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm run test:admin-memory
```

Expected: FAIL because `dist-electron/main/admin-control-plane/service.js` cannot be required.

---

### Task 2: Core Types, Schema, Service, And mem0 Adapter

**Files:**
- Create: `src/types/admin-control-plane.ts`
- Create: `src/main/admin-control-plane/schema.ts`
- Create: `src/main/admin-control-plane/service.ts`
- Create: `src/main/admin-control-plane/mem0-provider.ts`
- Modify: `src/main/database/system-config-store.ts`
- Modify: `package.json`

- [ ] **Step 1: Define shared types**

Create `src/types/admin-control-plane.ts` with these required unions:

```ts
export type AdminRole = 'admin' | 'ops_lead' | 'operator' | 'viewer';
export type StoreStatus = 'operating' | 'paused' | 'closed';
export type EmployeeStatus = 'active' | 'transferred' | 'offboarded';
export type ConversationStatus = 'active' | 'muted' | 'archived';
export type MemoryScope = 'enterprise' | 'employee' | 'conversation' | 'store' | 'task';
export type MemoryStatus = 'candidate' | 'pending_review' | 'active' | 'conflicted' | 'expired' | 'archived' | 'rejected';
export type BrowserProfileStatus = 'healthy' | 'needs_reauth' | 'expired' | 'revoked' | 'locked' | 'unhealthy';
export type BrowserActionLevel = 'read_only' | 'low_risk_write' | 'medium_risk_write' | 'high_risk_write' | 'destructive';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AdminEntityType = 'store' | 'employee' | 'conversation' | 'platform_account' | 'browser_profile' | 'task';
export interface AdminActionRequest<TPayload = Record<string, unknown>> {
  action: string;
  payload?: TPayload;
}
```

Also define interfaces for stores, employees, conversations, assignments, bindings, memory items, browser profiles, provider sync rows, audit events, dashboard data, and action responses.

- [ ] **Step 2: Implement schema initializer**

Create `src/main/admin-control-plane/schema.ts` exporting `initAdminControlPlaneTables(db)`. It must create these tables with text IDs, status columns, `created_at`, `updated_at`, and indexes:

```text
stores
employees
feishu_conversations
store_assignments
conversation_store_bindings
platform_accounts
browser_profiles
browser_profile_permissions
browser_profile_health_checks
memory_items
memory_sources
memory_entity_links
memory_reviews
memory_versions
memory_provider_sync
operation_policies
audit_events
```

Unique indexes must cover employee connector/user, conversation connector/conversation, active store assignment, active conversation-store binding, memory entity link, and browser-profile permission.

- [ ] **Step 3: Implement the service**

Create `src/main/admin-control-plane/service.ts` exporting `AdminControlPlaneService`. Required methods:

```ts
constructor(db: Database.Database, mem0Provider?: Mem0MemoryProvider)
ensureSchema(): void
getDashboard(): AdminDashboard
createStore(input: CreateStoreInput, actorId?: string): AdminStore
listStores(): AdminStore[]
updateStore(id: string, input: Partial<CreateStoreInput>, actorId?: string): AdminStore
upsertEmployee(input: UpsertEmployeeInput, actorId?: string): AdminEmployee
listEmployees(): AdminEmployee[]
offboardEmployee(employeeId: string, actorId?: string): void
upsertFeishuConversation(input: UpsertFeishuConversationInput, actorId?: string): AdminFeishuConversation
listFeishuConversations(): AdminFeishuConversation[]
bindConversationToStore(input: BindConversationToStoreInput, actorId?: string): ConversationStoreBinding
assignEmployeeToStore(input: AssignEmployeeToStoreInput, actorId?: string): StoreAssignment
createMemoryItem(input: CreateMemoryItemInput, actorId?: string): AdminMemoryItem
listMemoryItems(filter?: ListMemoryItemsFilter): AdminMemoryItem[]
updateMemoryStatus(id: string, status: MemoryStatus, actorId?: string): AdminMemoryItem
createBrowserProfile(input: CreateBrowserProfileInput, actorId?: string): AdminBrowserProfile
listBrowserProfiles(): AdminBrowserProfile[]
grantBrowserProfilePermission(input: GrantBrowserProfilePermissionInput, actorId?: string): BrowserProfilePermission
listAuditEvents(filter?: ListAuditEventsFilter): AdminAuditEvent[]
buildPromptContextForConnectorSession(input: { connectorId: string; conversationId: string }): string
syncMemoryItemToProvider(memoryId: string, actorId?: string): Promise<AdminMemoryItem>
```

Every high-impact write must call `recordAuditEvent`. Prompt context must include store names, conversation names, active memory content, and browser profile capability labels. It must never include `storageStateRef`.

- [ ] **Step 4: Implement mem0 adapter**

Create `src/main/admin-control-plane/mem0-provider.ts` exporting:

```ts
export interface Mem0MemoryProvider {
  isEnabled(): boolean;
  addMemory(input: { id: string; content: string; scope: string; metadata: Record<string, unknown> }): Promise<{ providerMemoryId?: string; status: 'synced' | 'disabled' | 'error'; error?: string }>;
  deleteMemory(providerMemoryId: string): Promise<{ status: 'deleted' | 'disabled' | 'error'; error?: string }>;
}
```

`OptionalMem0Provider` must dynamically import `mem0ai/oss` only when enabled. Disabled or failed mem0 calls must update provider sync state without blocking SQLite writes.

- [ ] **Step 5: Wire schema into SystemConfigStore**

Modify `src/main/database/system-config-store.ts` to import `initAdminControlPlaneTables` and call it inside `initTables()` after connector tables exist.

- [ ] **Step 6: Verify GREEN for service tests**

Run:

```bash
pnpm run test:admin-memory
```

Expected: PASS.

---

### Task 3: IPC, Web API, And Renderer Client

**Files:**
- Create: `src/main/ipc/admin-control-plane-handler.ts`
- Create: `src/server/routes/admin-control-plane.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/server/index.ts`
- Modify: `src/types/ipc.ts`
- Modify: `src/types/window.d.ts`
- Modify: `src/renderer/api/index.ts`

- [ ] **Step 1: Add IPC channel**

Add this IPC channel:

```ts
ADMIN_CONTROL_PLANE_REQUEST: 'admin-control-plane:request'
```

- [ ] **Step 2: Add action dispatcher**

Create a dispatcher that handles:

```text
dashboard.get
stores.list
stores.create
stores.update
employees.list
employees.upsert
employees.offboard
conversations.list
conversations.upsert
conversationStoreBindings.create
storeAssignments.create
memories.list
memories.create
memories.updateStatus
memories.sync
browserProfiles.list
browserProfiles.create
browserProfilePermissions.grant
auditEvents.list
```

The same dispatcher must be used by IPC and Express.

- [ ] **Step 3: Register IPC and preload**

Register `registerAdminControlPlaneHandlers()` from `src/main/index.ts`, expose `deepbot.adminControlPlane(request)` from preload, and update `window.d.ts`.

- [ ] **Step 4: Add Express route**

Mount `POST /api/admin-control-plane` and return the same response shape as IPC.

- [ ] **Step 5: Add renderer API methods**

Add typed convenience methods in `src/renderer/api/index.ts` for dashboard, store CRUD, employee upsert/offboard, conversation upsert, binding, assignment, memory governance, browser vault, and audit listing.

- [ ] **Step 6: Verify API type safety**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

---

### Task 4: Prompt Context Integration

**Files:**
- Create: `src/main/admin-control-plane/prompt-context.ts`
- Modify: `src/main/prompts/system-prompt.ts`

- [ ] **Step 1: Implement session prompt renderer**

Create `buildAdminMemoryPromptContextForSession(sessionId)` that resolves the active tab from `getGatewayInstance()`, skips non-connector tabs, and delegates to `AdminControlPlaneService.buildPromptContextForConnectorSession`.

- [ ] **Step 2: Inject after legacy memory**

Modify `system-prompt.ts` to append:

```text
## 运营记忆控制平面
```

only when the scoped context is non-empty.

- [ ] **Step 3: Verify prompt safety**

Run:

```bash
pnpm run test:admin-memory
```

Expected: PASS, including secret exclusion.

---

### Task 5: Admin Console UI

**Files:**
- Create: `src/renderer/components/AdminConsole.tsx`
- Create: `src/renderer/styles/admin-console.css`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/ChatWindow.tsx`

- [ ] **Step 1: Build full-screen admin console**

Create `AdminConsole.tsx` with section state:

```ts
type AdminSection = 'dashboard' | 'stores' | 'conversations' | 'employees' | 'memories' | 'browser-vault' | 'audit';
```

Render dashboard counters, store directory create form, conversation create and binding controls, employee upsert/offboard and assignment controls, memory create/status/sync controls, browser profile create controls, and audit log table.

- [ ] **Step 2: Add console styling**

Create `admin-console.css` using existing CSS variables. Use dense operations-console layout, icon buttons from `lucide-react`, 8px or smaller radii, no marketing hero, no decorative gradients.

- [ ] **Step 3: Add app state and toolbar entry**

Modify `App.tsx` and `ChatWindow.tsx` so the top toolbar opens the admin console with an `[ADMIN]` button.

- [ ] **Step 4: Verify renderer**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

---

### Task 6: Final Verification And Completion Review

**Files:**
- All files above.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm run test:admin-memory
```

Expected: PASS.

- [ ] **Step 2: Run all TypeScript checks**

Run:

```bash
pnpm run type-check
pnpm run type-check:server
```

Expected: both exit code 0.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm run build
```

Expected: exit code 0 and generated build output under ignored build directories.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only admin control-plane, UI, prompt, API, IPC, package, and plan-related changes in the isolated worktree.

- [ ] **Step 5: Completion audit**

Check direct evidence for each requirement: structured SQLite authority, memory governance metadata, provider sync state, browser profile reference vault, secret-free prompt context, visual admin console, scoped store/conversation memory injection, optional mem0 sync, legacy Markdown compatibility, IPC and Express access, and audit events.
