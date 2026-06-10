# Feishu Remote-Assist Login Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee start a merchant-platform login from Feishu, complete the login through a browser-act remote-assist link, and persist the resulting browser-act login state as a governed store-bound browser profile.

**Architecture:** The Feishu connector owns the employee-facing command flow, while a deterministic `BrowserActControlService` owns browser-act CLI calls outside the LLM tool path. SQLite remains the authority for employee, store, platform-account, login-request, browser-profile, permission, health, and audit state; browser-act remains the only holder of cookies and login state.

**Tech Stack:** TypeScript, Electron main process, Feishu connector, existing admin control-plane SQLite service, browser-act CLI `0.1.27`, Node 22 `node:test`, React admin console, pnpm.

---

## Confirmed Product Decisions

- Remote-assist links are sent only to the requesting employee through Feishu private message, never to a group chat.
- Login requests expire after 10 minutes.
- Raw cookies, tokens, passwords, verification codes, and storage-state JSON are never stored in SQLite or injected into prompts.
- The persisted browser profile reference uses the format `browser-act:<browser_id>`.
- The first implementation targets one platform, Meituan, before expanding to Eleme, Douyin, Xiaohongshu, or custom merchant backends.
- Unsupported platforms are rejected before browser-act opens any page; there is no generic fallback URL.
- Browser selection requires an explicit semantic match on platform or store name; the connector must not silently use the first available browser.

## Risk Account Definition

A **risk account** is a platform account or login profile where a mistaken, unauthorized, or automated action can materially affect store operations, money flow, customer-facing information, platform trust, or legal/compliance exposure.

Classify accounts using both platform capability and actual granted action level:

```ts
export type RiskAccountClass = 'standard' | 'sensitive' | 'high_risk' | 'critical';

export function classifyRiskAccount(input: {
  platform: string;
  canChangePrice?: boolean;
  canPublishMenu?: boolean;
  canChangeStoreStatus?: boolean;
  canAccessSettlement?: boolean;
  canManageRefunds?: boolean;
  canChangeBankOrInvoice?: boolean;
  canDeleteAssets?: boolean;
  storeCount?: number;
}): RiskAccountClass {
  if (input.canChangeBankOrInvoice || input.canDeleteAssets) return 'critical';
  if (input.canChangePrice || input.canPublishMenu || input.canChangeStoreStatus || input.canManageRefunds) return 'high_risk';
  if (input.canAccessSettlement || (input.storeCount ?? 0) > 1) return 'sensitive';
  return 'standard';
}
```

Operational policy:

```text
standard   -> read-only checks, low operational blast radius
sensitive  -> financial visibility or multi-store visibility; require scoped employee permission
high_risk  -> can modify customer-facing operations; require employee confirmation for writes
critical   -> can change payout, identity, deletion, destructive settings; require admin approval before use
```

Examples:

```text
Meituan read-only reporting account                         -> sensitive
Meituan menu/price/store-decoration operator account        -> high_risk
Meituan account with settlement, invoice, bank, delete power -> critical
Eleme order/refund management account                       -> high_risk
Store-local browser profile for dashboard screenshots only  -> standard
```

---

## File Structure

- Create `src/main/browser-act/browser-act-control-service.ts`: deterministic browser-act CLI wrapper for listing browsers/profiles, creating browsers, opening login sessions, remote-assist, verification helpers, and session cleanup.
- Create `src/main/browser-act/browser-act-parser.ts`: parser for `browser-act browser list`, `browser-act browser list-profiles`, and remote-assist output.
- Create `src/main/browser-act/browser-act-login-verifiers.ts`: platform-specific login validators, starting with Meituan.
- Modify `src/main/admin-control-plane/schema.ts`: add login-request columns/table and platform-account fields needed for self-service login.
- Modify `src/types/admin-control-plane.ts`: add platform-account, login-request, browser-act browser, risk-account, and login-command types.
- Modify `src/main/admin-control-plane/service.ts`: add platform-account CRUD, login-request state transitions, profile upsert from browser-act, health-check recording, and risk classification.
- Modify `src/main/admin-control-plane/actions.ts`: add admin actions for platform accounts, login requests, browser-act sync, and health checks.
- Create `src/main/connectors/feishu/login-command-handler.ts`: parse `/login`, `/login-done`, `/login-cancel`, and `/login-status`.
- Modify `src/main/connectors/feishu/feishu-connector.ts`: call the login command handler after pairing/security checks and before normal agent handoff.
- Modify `src/renderer/components/AdminConsole.tsx`: show platform accounts, login requests, browser-act sync, risk class, expiration, and health.
- Modify `src/renderer/styles/admin-console.css`: add UI states for login request and risk classes.
- Create `scripts/browser-act-control-service.test.mjs`: unit tests for parser, command construction, risk classification, and service transitions with a fake runner.
- Create `scripts/feishu-login-command-handler.test.mjs`: command parsing and permission tests.
- Modify `package.json`: add `test:remote-login`.

---

### Task 1: RED BrowserAct Control Service Tests

**Files:**
- Create: `scripts/browser-act-control-service.test.mjs`
- Create: `src/main/browser-act/browser-act-parser.ts`
- Create: `src/main/browser-act/browser-act-control-service.ts`
- Modify: `package.json`

- [x] **Step 1: Add the failing test script**

Add this script:

```json
"test:remote-login": "node scripts/browser-act-control-service.test.mjs && node scripts/feishu-login-command-handler.test.mjs"
```

- [x] **Step 2: Write the failing parser and command-construction test**

Create `scripts/browser-act-control-service.test.mjs`:

```js
const assert = require('node:assert/strict');

const {
  parseBrowserActBrowserList,
  parseBrowserActProfileList,
  extractRemoteAssistUrl,
} = require('../dist-electron/main/browser-act/browser-act-parser.js');

const {
  BrowserActControlService,
  classifyRiskAccount,
} = require('../dist-electron/main/browser-act/browser-act-control-service.js');

class FakeRunner {
  constructor() {
    this.calls = [];
  }

  async run(args) {
    this.calls.push(args);
    if (args.join(' ') === 'browser list') {
      return 'id=chrome_local_1 name="meituan-merchant" type=chrome state=idle\\n  desc="美团商家后台操作"';
    }
    if (args.join(' ') === 'browser list-profiles') {
      return '  local_profile_1 您的 Chrome     local      -                              Chrome\\n  browser:chrome_local_1 meituan-merchant managed - meituan-merchant';
    }
    if (args.includes('remote-assist')) {
      return 'Remote assist URL: https://assist.browseract.local/session/login_req_1';
    }
    return '';
  }
}

async function main() {
  const browsers = parseBrowserActBrowserList('id=chrome_local_1 name="meituan-merchant" type=chrome state=idle\\n  desc="美团商家后台操作"');
  assert.equal(browsers[0].id, 'chrome_local_1');
  assert.equal(browsers[0].name, 'meituan-merchant');
  assert.equal(browsers[0].type, 'chrome');
  assert.equal(browsers[0].state, 'idle');
  assert.equal(browsers[0].desc, '美团商家后台操作');

  const profiles = parseBrowserActProfileList('  local_profile_1 您的 Chrome     local      -                              Chrome');
  assert.equal(profiles[0].id, 'local_profile_1');
  assert.equal(profiles[0].name, '您的 Chrome');
  assert.equal(profiles[0].kind, 'local');

  assert.equal(extractRemoteAssistUrl('Remote assist URL: https://assist.browseract.local/session/login_req_1'), 'https://assist.browseract.local/session/login_req_1');

  const runner = new FakeRunner();
  const service = new BrowserActControlService({ runner, workspaceDir: process.cwd() });
  await service.openBrowserForLogin({
    sessionName: 'login_req_1',
    browserId: 'chrome_local_1',
    url: 'https://ecom.meituan.com/',
  });
  await service.createRemoteAssist({
    sessionName: 'login_req_1',
    objective: '请登录美团望京店商家后台',
  });

  assert.deepEqual(runner.calls[2], ['--session', 'login_req_1', 'browser', 'open', 'chrome_local_1', 'https://ecom.meituan.com/']);
  assert.deepEqual(runner.calls[3], ['--session', 'login_req_1', 'remote-assist', '--objective', '请登录美团望京店商家后台']);

  assert.equal(classifyRiskAccount({ platform: 'meituan', canChangePrice: true }), 'high_risk');
  assert.equal(classifyRiskAccount({ platform: 'meituan', canChangeBankOrInvoice: true }), 'critical');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [x] **Step 3: Verify RED**

Run:

```bash
pnpm run build:main
pnpm run test:remote-login
```

Expected: FAIL because `dist-electron/main/browser-act/browser-act-parser.js` does not exist.

---

### Task 2: BrowserAct Control Service

**Files:**
- Create: `src/main/browser-act/browser-act-parser.ts`
- Create: `src/main/browser-act/browser-act-control-service.ts`
- Test: `scripts/browser-act-control-service.test.mjs`

- [x] **Step 1: Implement parser module**

Create `src/main/browser-act/browser-act-parser.ts`:

```ts
export interface BrowserActBrowserSummary {
  id: string;
  name: string;
  type: 'chrome' | 'chrome-direct' | 'stealth' | string;
  state?: string;
  desc?: string;
}

export interface BrowserActProfileSummary {
  id: string;
  name: string;
  kind: string;
  source?: string;
}

export function parseBrowserActBrowserList(output: string): BrowserActBrowserSummary[] {
  const rows: BrowserActBrowserSummary[] = [];
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^id=(\S+)\s+name="([^"]+)"\s+type=(\S+)(?:\s+state=(\S+))?/);
    if (!match) continue;
    const descLine = lines[index + 1]?.match(/^\s+desc="([^"]*)"/);
    rows.push({
      id: match[1],
      name: match[2],
      type: match[3],
      state: match[4],
      desc: descLine?.[1],
    });
  }
  return rows;
}

export function parseBrowserActProfileList(output: string): BrowserActProfileSummary[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Total:') && !line.startsWith('Tip:'))
    .map((line) => {
      const parts = line.split(/\s{2,}/);
      return {
        id: parts[0],
        name: parts[1] || parts[0],
        kind: parts[2] || 'unknown',
        source: parts[4],
      };
    });
}

export function extractRemoteAssistUrl(output: string): string {
  const match = output.match(/https?:\/\/\S+/);
  if (!match) throw new Error('browser-act remote-assist output did not contain a URL');
  return match[0].replace(/[)\].,;]+$/, '');
}
```

- [x] **Step 2: Implement deterministic service**

Create `src/main/browser-act/browser-act-control-service.ts`:

```ts
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractRemoteAssistUrl, parseBrowserActBrowserList, parseBrowserActProfileList } from './browser-act-parser';

export type RiskAccountClass = 'standard' | 'sensitive' | 'high_risk' | 'critical';

export interface BrowserActRunner {
  run(args: string[], timeoutSeconds?: number): Promise<string>;
}

export class SpawnBrowserActRunner implements BrowserActRunner {
  constructor(private readonly workspaceDir: string, private readonly binary = resolveBrowserActBinary()) {}

  run(args: string[], timeoutSeconds = 120): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        cwd: this.workspaceDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`browser-act timed out after ${timeoutSeconds}s: ${args.join(' ')}`));
      }, timeoutSeconds * 1000);
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(stdout);
        else reject(new Error(`browser-act failed (${code}): ${stderr || stdout}`));
      });
    });
  }
}

function resolveBrowserActBinary(): string {
  const configured = process.env.BROWSER_ACT_BIN?.trim();
  if (configured) return configured;
  const local = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'browser-act.cmd' : 'browser-act');
  return existsSync(local) ? local : 'browser-act';
}

export function classifyRiskAccount(input: {
  platform: string;
  canChangePrice?: boolean;
  canPublishMenu?: boolean;
  canChangeStoreStatus?: boolean;
  canAccessSettlement?: boolean;
  canManageRefunds?: boolean;
  canChangeBankOrInvoice?: boolean;
  canDeleteAssets?: boolean;
  storeCount?: number;
}): RiskAccountClass {
  if (input.canChangeBankOrInvoice || input.canDeleteAssets) return 'critical';
  if (input.canChangePrice || input.canPublishMenu || input.canChangeStoreStatus || input.canManageRefunds) return 'high_risk';
  if (input.canAccessSettlement || (input.storeCount ?? 0) > 1) return 'sensitive';
  return 'standard';
}

export class BrowserActControlService {
  private readonly runner: BrowserActRunner;

  constructor(options: { workspaceDir: string; runner?: BrowserActRunner }) {
    this.runner = options.runner || new SpawnBrowserActRunner(options.workspaceDir);
  }

  async listBrowsers() {
    return parseBrowserActBrowserList(await this.runner.run(['browser', 'list']));
  }

  async listProfiles() {
    return parseBrowserActProfileList(await this.runner.run(['browser', 'list-profiles']));
  }

  async openBrowserForLogin(input: { sessionName: string; browserId: string; url: string }): Promise<void> {
    await this.runner.run(['--session', input.sessionName, 'browser', 'open', input.browserId, input.url], 180);
  }

  async createRemoteAssist(input: { sessionName: string; objective: string }): Promise<string> {
    const output = await this.runner.run(['--session', input.sessionName, 'remote-assist', '--objective', input.objective], 120);
    return extractRemoteAssistUrl(output);
  }

  async closeSession(sessionName: string): Promise<void> {
    await this.runner.run(['session', 'close', sessionName], 60);
  }
}
```

- [x] **Step 3: Verify GREEN**

Run:

```bash
pnpm run build:main
pnpm run test:remote-login
```

Expected: parser and service assertions pass; Feishu handler test still fails until Task 5 exists.

---

### Task 3: Admin Control-Plane Login Request Model

**Files:**
- Modify: `src/main/admin-control-plane/schema.ts`
- Modify: `src/types/admin-control-plane.ts`
- Modify: `src/main/admin-control-plane/service.ts`
- Modify: `src/main/admin-control-plane/actions.ts`
- Test: `scripts/browser-act-control-service.test.mjs`

- [x] **Step 1: Add login request and platform-account types**

Add:

```ts
export type BrowserLoginRequestStatus =
  | 'pending_confirmation'
  | 'creating_browser'
  | 'waiting_employee_login'
  | 'verifying'
  | 'healthy'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface AdminPlatformAccount {
  id: string;
  platform: string;
  label: string;
  storeId?: string;
  accountRef?: string;
  status: 'active' | 'paused' | 'revoked';
  riskAccountClass: 'standard' | 'sensitive' | 'high_risk' | 'critical';
  createdAt: number;
  updatedAt: number;
}

export interface BrowserLoginRequest {
  id: string;
  connectorId: string;
  requesterUserId: string;
  requesterOpenId?: string;
  employeeId?: string;
  storeId: string;
  platform: string;
  platformAccountId?: string;
  browserProfileId?: string;
  browserActBrowserId?: string;
  sessionName: string;
  status: BrowserLoginRequestStatus;
  loginUrl: string;
  expiresAt: number;
  verifiedAt?: number;
  failedReason?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [x] **Step 2: Add schema**

Add:

```sql
CREATE TABLE IF NOT EXISTS browser_login_requests (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  requester_open_id TEXT,
  employee_id TEXT,
  store_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_account_id TEXT,
  browser_profile_id TEXT,
  browser_act_browser_id TEXT,
  session_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  login_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER,
  failed_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

Add index:

```sql
CREATE INDEX IF NOT EXISTS idx_browser_login_requests_requester
ON browser_login_requests(connector_id, requester_user_id, status, expires_at)
```

- [x] **Step 3: Add service methods**

Implement:

```ts
createBrowserLoginRequest(input, actorId?: string): BrowserLoginRequest
markBrowserLoginRequestWaiting(id: string, browserActBrowserId: string, actorId?: string): BrowserLoginRequest
markBrowserLoginRequestHealthy(id: string, browserProfileId: string, actorId?: string): BrowserLoginRequest
markBrowserLoginRequestFailed(id: string, reason: string, actorId?: string): BrowserLoginRequest
expireBrowserLoginRequests(nowMs?: number): number
```

The `createBrowserLoginRequest` method must set:

```ts
expiresAt = Date.now() + 10 * 60 * 1000
sessionName = `login_${id}`
status = 'pending_confirmation'
```

- [x] **Step 4: Verify**

Run:

```bash
pnpm run test:admin-memory
pnpm run build:main
```

Expected: existing admin memory tests still pass.

---

### Task 4: Browser Profile Upsert, Health, And Secret-Free Prompt Context

**Files:**
- Modify: `src/main/admin-control-plane/service.ts`
- Modify: `src/types/admin-control-plane.ts`
- Modify: `scripts/admin-control-plane-prompt.test.mjs`

- [x] **Step 1: Extend prompt test**

Add a browser profile with:

```js
storageStateRef: 'browser-act:chrome_local_1',
allowedActionLevel: 'high_risk_write',
```

Assert:

```js
assert.match(context, /最高动作:high_risk_write/);
assert.doesNotMatch(context, /chrome_local_1/);
assert.doesNotMatch(context, /browser-act:/);
```

- [x] **Step 2: Implement safe profile upsert**

Add:

```ts
upsertBrowserProfileFromBrowserAct(input: {
  platform: string;
  label: string;
  storeId: string;
  browserActBrowserId: string;
  riskLevel: RiskLevel;
  allowedActionLevel: BrowserActionLevel;
  lastSuccessfulUseAt?: number;
}, actorId?: string): AdminBrowserProfile
```

It must store:

```ts
storageStateRef = `browser-act:${input.browserActBrowserId}`
status = 'healthy'
```

It must never expose the browser id in prompt context.

- [x] **Step 3: Verify**

Run:

```bash
pnpm run test:admin-memory
```

Expected: all admin memory tests pass and prompt still excludes browser-act IDs.

---

### Task 5: Feishu Login Command Handler

**Files:**
- Create: `scripts/feishu-login-command-handler.test.mjs`
- Create: `src/main/connectors/feishu/login-command-handler.ts`
- Modify: `src/main/connectors/feishu/feishu-connector.ts`

- [x] **Step 1: Write failing command parser tests**

Create `scripts/feishu-login-command-handler.test.mjs`:

```js
const assert = require('node:assert/strict');
const {
  parseLoginCommand,
  formatLoginRequestPrivateMessage,
} = require('../dist-electron/main/connectors/feishu/login-command-handler.js');

const start = parseLoginCommand('/login 美团 望京店');
assert.equal(start.kind, 'start');
assert.equal(start.platform, '美团');
assert.equal(start.storeName, '望京店');

const done = parseLoginCommand('/login-done abc123');
assert.equal(done.kind, 'done');
assert.equal(done.requestCode, 'abc123');

assert.equal(parseLoginCommand('普通消息'), null);

const privateMessage = formatLoginRequestPrivateMessage({
  platform: '美团',
  storeName: '望京店',
  expiresAt: new Date('2026-06-10T10:10:00.000Z').getTime(),
  remoteAssistUrl: 'https://assist.example/login',
});
assert.match(privateMessage, /只发给你本人/);
assert.match(privateMessage, /10 分钟/);
assert.match(privateMessage, /https:\/\/assist\.example\/login/);
```

- [x] **Step 2: Implement parser and message formatter**

Create:

```ts
export type LoginCommand =
  | { kind: 'start'; platform: string; storeName: string }
  | { kind: 'done'; requestCode: string }
  | { kind: 'cancel'; requestCode: string }
  | { kind: 'status'; requestCode: string };

export function parseLoginCommand(text: string): LoginCommand | null {
  const trimmed = text.trim();
  const start = trimmed.match(/^\/login\s+(\S+)\s+(.+)$/);
  if (start) return { kind: 'start', platform: start[1], storeName: start[2].trim() };
  const done = trimmed.match(/^\/login-done\s+(\S+)$/);
  if (done) return { kind: 'done', requestCode: done[1] };
  const cancel = trimmed.match(/^\/login-cancel\s+(\S+)$/);
  if (cancel) return { kind: 'cancel', requestCode: cancel[1] };
  const status = trimmed.match(/^\/login-status\s+(\S+)$/);
  if (status) return { kind: 'status', requestCode: status[1] };
  return null;
}

export function formatLoginRequestPrivateMessage(input: {
  platform: string;
  storeName: string;
  expiresAt: number;
  remoteAssistUrl: string;
}): string {
  return [
    `你正在为 ${input.storeName} 绑定 ${input.platform} 登录态。`,
    '这个远程协助链接只发给你本人，请不要转发到群聊或其他人。',
    '登录请求 10 分钟后过期。',
    `远程协助链接：${input.remoteAssistUrl}`,
    '完成登录后回复 /login-done <登录码>。',
  ].join('\n');
}
```

- [x] **Step 3: Integrate after Feishu security check**

In `feishu-connector.ts`, after `checkSecurity()` returns true and before normal `connectorManager.handleIncomingMessage`, call:

```ts
const loginCommand = parseLoginCommand(feishuMessage.content.text || '');
if (loginCommand) {
  await this.loginCommandHandler.handle(loginCommand, feishuMessage);
  return;
}
```

The handler must send remote-assist links using `_receiveIdType: 'open_id'` when `openId` is present, not to the group conversation.

- [x] **Step 4: Verify**

Run:

```bash
pnpm run build:main
pnpm run test:remote-login
```

Expected: command parser and private-message formatting tests pass.

---

### Task 6: Admin Console Login-State UX

**Files:**
- Modify: `src/renderer/components/AdminConsole.tsx`
- Modify: `src/renderer/styles/admin-console.css`
- Modify: `src/renderer/api/index.ts`

- [x] **Step 1: Add admin API convenience methods**

Add methods:

```ts
adminListPlatformAccounts()
adminListBrowserLoginRequests()
adminListBrowserActBrowsers()
adminImportBrowserActProfile(input)
adminExpireBrowserLoginRequests()
```

- [x] **Step 2: Add UI rows**

In the 登录态 section, show:

```text
BrowserAct ID
风险账号等级
最高动作
最近验证
登录请求状态
10 分钟过期时间
```

Render remote-assist URLs only as `已私发给员工`, never as clickable admin-table text.

- [x] **Step 3: Add risk labels**

Use CSS classes:

```tsx
<span className={`admin-risk admin-risk-${riskAccountClass}`}>{riskAccountClass}</span>
```

- [x] **Step 4: Verify**

Run:

```bash
pnpm run type-check
pnpm run build
```

Expected: renderer compiles and admin console still renders.

---

## Implementation Status

- [x] BrowserAct parser and control service.
- [x] Control-plane schema and request lifecycle.
- [x] Prompt-safe browser profile upsert.
- [x] Feishu private-message login command handler.
- [x] Admin UI for sync, login requests, and risk state.
- [x] Platform-specific Meituan login verifier.
- [x] Local simulated Feishu/browser-act login flow test.
- [ ] End-to-end manual verification with a non-production merchant account.

Local browser-act feasibility check on 2026-06-10:

```text
CLI version: v0.1.27
skill compatibility: ok
available matching browser:
  id=chrome_local_100639328469778646
  name=meituan-merchant
  type=chrome
  state=idle
  desc=美团商家后台操作，已导入本地Chrome登录状态
```

The code path is implementable with the installed CLI because browser-act supports `browser open`, `remote-assist`, `eval location.href`, `get title`, and `get markdown`. Full end-to-end verification still requires a Feishu test employee and a non-production or explicitly approved merchant account; do not open or operate a real merchant backend from this plan without that approval.

Additional local hardening on 2026-06-10:

```text
First rollout platform gate:
  美团 / meituan / mt -> https://ecom.meituan.com/
  all other platforms -> rejected before opening browser-act

Browser selection gate:
  matched by platform or store name -> allowed
  no explicit semantic match -> rejected with admin remediation
```

Local simulated E2E coverage on 2026-06-10:

```text
script: scripts/feishu-remote-login-flow.test.mjs
coverage:
  Feishu /login command -> private open_id message
  10-minute login request expiry
  browser-act browser open + remote-assist command construction
  /login-done -> browser-act URL/title/markdown verification
  verified browser profile storage_state_ref = browser-act:<id>
  prompt context exposes capability label/action level but not browser-act id
```

## Manual Verification Script

Use a test Feishu employee paired with the connector.

```text
1. Admin creates store: 望京店
2. Admin creates employee mapped to Feishu pairing user
3. Admin assigns employee to 望京店
4. Employee sends /login 美团 望京店 in Feishu private chat
5. System sends remote-assist link only to that employee
6. Employee completes login in remote assist
7. Employee replies /login-done <code>
8. System verifies login and writes browser_profiles.storage_state_ref = browser-act:<id>
9. Admin console shows profile status healthy
10. Prompt context shows login capability label but does not expose browser-act id
```

## Self-Review

- Spec coverage: The plan covers Feishu command entry, 10-minute expiry, employee-only remote-assist delivery, browser-act state persistence, risk-account classification, browser profile governance, prompt secrecy, admin UI, and tests.
- Placeholder scan: No unresolved placeholders remain.
- Type consistency: `BrowserLoginRequest`, `RiskAccountClass`, `BrowserActControlService`, and `storageStateRef = browser-act:<id>` are used consistently across tasks.
