# Policy Service and Three-Layer Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal business `PolicyService` and `MemoryGateway` so runtime prompts use structured enterprise, conversation, and employee memory only.

**Architecture:** Keep SQLite admin control plane as the authority. `PolicyService` resolves allowed conversation, actor, store, memory, and browser-profile scope; `MemoryGateway` formats only allowed structured memory into prompt sections. System prompt builders stop injecting old Markdown memory automatically.

**Tech Stack:** TypeScript, Electron main process, SQLite adapter, Node test runner scripts.

---

## File Structure

- Modify `src/types/admin-control-plane.ts`: add policy and gateway DTOs.
- Create `src/main/admin-control-plane/policy-service.ts`: evaluate runtime memory and browser capability scope.
- Create `src/main/admin-control-plane/memory-gateway.ts`: retrieve and format allowed memory sections.
- Modify `src/main/admin-control-plane/service.ts`: delegate legacy `buildPromptContextForConnectorSession` to the gateway.
- Modify `src/main/admin-control-plane/prompt-context.ts`: route session prompt context through the gateway.
- Modify `src/main/prompts/system-prompt.ts`: remove automatic old Markdown memory injection.
- Modify `src/main/prompts/memory-sections.ts`: remove old Markdown from Fast mode helpers and rename the structured section.
- Modify `src/main/agent-runtime/agent-runtime.ts`: use structured gateway context in Fast mode.
- Create `scripts/admin-control-plane-policy-memory-gateway.test.mjs`: prove policy and gateway behavior.
- Modify `scripts/admin-control-plane-prompt.test.mjs`: align prompt expectations with three-layer memory.
- Modify `scripts/memory-prompt-sections.test.mjs`: prove old Markdown is not injected.
- Modify `package.json`: include the new test in `test:admin-memory`.

## Task 1: Policy and Gateway Tests

**Files:**
- Create: `scripts/admin-control-plane-policy-memory-gateway.test.mjs`
- Modify: `scripts/admin-control-plane-prompt.test.mjs`
- Modify: `scripts/memory-prompt-sections.test.mjs`
- Modify: `package.json`

- [x] **Step 1: Write failing policy/gateway test**

Create `scripts/admin-control-plane-policy-memory-gateway.test.mjs` with a Node test that:

```js
const decision = policy.evaluateMemoryRead({
  connectorId: 'feishu',
  conversationId: 'oc_test3',
  actorUserId: 'ou_active',
  action: 'memory.read',
});

assert.equal(decision.effect, 'allow');
assert.deepEqual(decision.allowedMemoryScopes, ['enterprise', 'conversation', 'employee']);
assert.deepEqual(decision.allowedStoreIds, [store.id]);

const context = gateway.buildPromptContext({
  connectorId: 'feishu',
  conversationId: 'oc_test3',
  actorUserId: 'ou_active',
});

assert.match(context, /### 企业记忆/);
assert.match(context, /### 群聊记忆/);
assert.match(context, /### 个人记忆/);
assert.match(context, /企业日报默认先看营业额/);
assert.match(context, /测试3群本周关注差评回复/);
assert.match(context, /石岩店午高峰要提前补打包袋/);
assert.match(context, /用户喜欢先看预警/);
assert.doesNotMatch(context, /别的群记忆/);
assert.doesNotMatch(context, /别的员工记忆/);
assert.doesNotMatch(context, /token=abc123/);
assert.doesNotMatch(context, /browser-act:/);
assert.doesNotMatch(context, /chrome_local_1/);
```

Also assert that calling the gateway without `actorUserId` omits personal memory, and that an offboarded employee loses personal memory access.

- [x] **Step 2: Update prompt section failing test**

Change `scripts/memory-prompt-sections.test.mjs` so old Markdown input is ignored:

```js
const prompt = buildFastModeSystemPrompt({
  agentName: 'DianBot',
  userName: '管理员',
  memoryContent: '旧记忆：人民广场店负责人是小张。',
  adminMemoryContext: '### 企业记忆\n- 企业日报默认先看营业额。',
});

assert.doesNotMatch(prompt, /旧记忆/);
assert.match(prompt, /## 运营上下文/);
assert.match(prompt, /企业日报默认先看营业额/);
```

- [x] **Step 3: Update existing prompt test expectation**

Keep `scripts/admin-control-plane-prompt.test.mjs` focused on secret exclusion, but expect `### 群聊记忆` instead of the old `可用运营记忆` wording.

- [x] **Step 4: Add test script**

Add `node scripts/admin-control-plane-policy-memory-gateway.test.mjs` to `test:admin-memory`.

- [x] **Step 5: Run test and verify RED**

Run:

```bash
pnpm run test:admin-memory
```

Expected: FAIL because `policy-service.ts`, `memory-gateway.ts`, and new prompt behavior do not exist yet.

## Task 2: PolicyService

**Files:**
- Modify: `src/types/admin-control-plane.ts`
- Create: `src/main/admin-control-plane/policy-service.ts`

- [x] **Step 1: Add types**

Add:

```ts
export type RuntimeMemoryScope = 'enterprise' | 'conversation' | 'employee';
export type PolicyEffect = 'allow' | 'deny' | 'requires_confirmation';

export interface MemoryReadPolicyInput {
  connectorId: string;
  conversationId?: string;
  actorUserId?: string;
  actorEmployeeId?: string;
  action?: string;
  riskLevel?: RiskLevel;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  companyId?: string;
  actorEmployeeId?: string;
  conversationInternalId?: string;
  allowedStoreIds: string[];
  allowedMemoryScopes: RuntimeMemoryScope[];
  allowedBrowserProfileIds: string[];
}
```

- [x] **Step 2: Implement policy service**

Create `PolicyService` with:

```ts
evaluateMemoryRead(input: MemoryReadPolicyInput): PolicyDecision
```

Rules:

- Missing or inactive conversation returns `deny`.
- Active conversation allows enterprise and conversation memory.
- Active matching employee adds employee memory.
- Offboarded employee does not add employee memory.
- Bound active stores become `allowedStoreIds`.
- Browser profile IDs are returned only from bound stores and statuses `healthy` or `needs_reauth`.

- [x] **Step 3: Run RED test again**

Run:

```bash
pnpm run test:admin-memory
```

Expected: still FAIL because the gateway and prompt changes are missing.

## Task 3: MemoryGateway

**Files:**
- Create: `src/main/admin-control-plane/memory-gateway.ts`
- Modify: `src/main/admin-control-plane/service.ts`
- Modify: `src/main/admin-control-plane/prompt-context.ts`

- [x] **Step 1: Implement gateway input**

Use:

```ts
export interface BuildMemoryGatewayPromptInput {
  connectorId: string;
  conversationId: string;
  actorUserId?: string;
  actorEmployeeId?: string;
}
```

- [x] **Step 2: Implement structured retrieval**

`MemoryGateway.buildPromptContext(input)` should:

- Call `PolicyService.evaluateMemoryRead`.
- Return empty string for `deny`.
- Query active enterprise memory with `scope='enterprise'`.
- Query active conversation memory with `scope='conversation'` linked to the conversation.
- Query active store/task memory linked to allowed store IDs and render it under group memory.
- Query active employee memory linked to the allowed employee ID and render it under personal memory.
- Query allowed browser profile rows by IDs from the policy decision.

- [x] **Step 3: Implement formatting**

Format with:

```text
会话: 测试3 (group)
关联门店:
- 趣东北·东北小馆(石岩店)

### 企业记忆
- ...

### 群聊记忆
- ...

### 个人记忆
- ...

### 可用浏览器登录态能力
- ...
```

Do not include `storageStateRef`, `profilePath`, `browser-act:*`, browser IDs, cookies, tokens, passwords, or verification codes.

- [x] **Step 4: Delegate old service method**

Make `AdminControlPlaneService.buildPromptContextForConnectorSession` call the gateway so existing callers get the new behavior.

- [x] **Step 5: Run gateway test**

Run:

```bash
pnpm run test:admin-memory
```

Expected: policy/gateway tests pass or reveal formatting mistakes only.

## Task 4: Remove Old Markdown Prompt Injection

**Files:**
- Modify: `src/main/prompts/system-prompt.ts`
- Modify: `src/main/prompts/memory-sections.ts`
- Modify: `src/main/agent-runtime/agent-runtime.ts`

- [x] **Step 1: Normal mode prompt**

Remove the `getMemoryContent(sessionId)` prompt block from `buildSystemPrompt`. Keep structured admin/gateway context.

- [x] **Step 2: Fast mode helper**

Change `buildFastModeSystemPrompt` so `memoryContent` is ignored and only `adminMemoryContext` is injected.

- [x] **Step 3: Fast mode runtime**

Change `AgentRuntime.buildFastModePrompt` to use:

```ts
const adminMemoryContext = buildAdminMemoryPromptContextForSession(sessionId);
return buildFastModeSystemPrompt({ agentName, userName: nameConfig.userName, adminMemoryContext });
```

- [x] **Step 4: Run prompt tests**

Run:

```bash
pnpm run test:admin-memory
```

Expected: PASS.

## Task 5: Verification

**Files:**
- No new files unless fixes are needed.

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm run test:admin-memory
```

Expected: PASS.

- [x] **Step 2: Run neighboring regression tests**

Run:

```bash
pnpm run test:remote-login
pnpm run test:rpa-data
```

Expected: PASS.

- [x] **Step 3: Run type check**

Run:

```bash
pnpm run type-check
```

Expected: PASS.

- [x] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

