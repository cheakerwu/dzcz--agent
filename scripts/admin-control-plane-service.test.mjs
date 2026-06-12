import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const { default: Database } = require('../dist-electron/shared/utils/sqlite-adapter.js');
const { AdminControlPlaneService } = require('../dist-electron/main/domains/admin-control-plane/service.js');

test('admin control plane manages store scope, memory, browser vault, and offboarding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-admin-memory-'));

  try {
    const db = new Database(join(dir, 'admin.db'));
    const service = new AdminControlPlaneService(db);
    service.ensureSchema();

    const store = service.createStore({
      name: '人民广场店',
      brand: '点之出众',
      city: '上海',
      area: '黄浦',
      status: 'operating',
    }, 'admin');
    const employee = service.upsertEmployee({
      connectorId: 'feishu',
      userId: 'ou_1',
      displayName: '小王',
      role: 'operator',
      status: 'active',
    }, 'admin');
    const conversation = service.upsertFeishuConversation({
      connectorId: 'feishu',
      conversationId: 'oc_1',
      chatType: 'group',
      name: '人民广场运营群',
      status: 'active',
    }, 'admin');

    service.assignEmployeeToStore({
      employeeId: employee.id,
      storeId: store.id,
      responsibility: 'owner',
    }, 'admin');
    service.bindConversationToStore({
      conversationId: conversation.id,
      storeId: store.id,
    }, 'admin');
    service.createMemoryItem({
      scope: 'store',
      category: 'ops_fact',
      content: '人民广场店午高峰需要提前补打包袋。',
      status: 'active',
      confidence: 0.93,
      entityLinks: [
        { entityType: 'store', entityId: store.id },
        { entityType: 'conversation', entityId: conversation.id },
      ],
    }, 'admin');
    service.createBrowserProfile({
      platform: 'meituan',
      label: '人民广场美团主账号',
      storeId: store.id,
      storageStateRef: '/secret/cookies.json',
      status: 'healthy',
      riskLevel: 'medium',
      allowedActionLevel: 'medium_risk_write',
    }, 'admin');

    const context = service.buildPromptContextForConnectorSession({
      connectorId: 'feishu',
      conversationId: 'oc_1',
    });
    assert.match(context, /人民广场店/);
    assert.match(context, /午高峰需要提前补打包袋/);
    assert.match(context, /人民广场美团主账号/);
    assert.doesNotMatch(context, /cookies\.json/);

    const platformAccount = service.createPlatformAccount({
      platform: 'meituan',
      label: '人民广场美团运营号',
      storeId: store.id,
      accountRef: 'mt-people-square-main',
      riskAccountClass: 'high_risk',
    }, 'admin');
    assert.equal(platformAccount.riskAccountClass, 'high_risk');

    const loginRequest = service.createBrowserLoginRequest({
      connectorId: 'feishu',
      requesterUserId: 'ou_1',
      requesterOpenId: 'ou_open_1',
      employeeId: employee.id,
      storeId: store.id,
      platform: 'meituan',
      platformAccountId: platformAccount.id,
      loginUrl: 'https://ecom.meituan.com/',
    }, 'admin');
    assert.equal(loginRequest.status, 'pending_confirmation');
    assert.equal(loginRequest.sessionName, `login_${loginRequest.id}`);
    assert.equal(loginRequest.expiresAt - loginRequest.createdAt, 10 * 60 * 1000);

    const waitingRequest = service.markBrowserLoginRequestWaiting(loginRequest.id, 'chrome_local_1', 'admin');
    assert.equal(waitingRequest.status, 'waiting_employee_login');
    assert.equal(waitingRequest.browserActBrowserId, 'chrome_local_1');

    const healthyRequest = service.markBrowserLoginRequestHealthy(loginRequest.id, 'browser_profile_1', 'admin');
    assert.equal(healthyRequest.status, 'healthy');
    assert.equal(healthyRequest.browserProfileId, 'browser_profile_1');
    assert.ok(healthyRequest.verifiedAt);

    const expiringRequest = service.createBrowserLoginRequest({
      connectorId: 'feishu',
      requesterUserId: 'ou_1',
      storeId: store.id,
      platform: 'meituan',
      loginUrl: 'https://ecom.meituan.com/',
    }, 'admin');
    assert.equal(service.expireBrowserLoginRequests(expiringRequest.expiresAt + 1), 1);
    const expiredRequest = service.listBrowserLoginRequests({ requesterUserId: 'ou_1' })
      .find((request) => request.id === expiringRequest.id);
    assert.equal(expiredRequest?.status, 'expired');

    service.offboardEmployee(employee.id, 'admin');
    const dashboard = service.getDashboard();
    assert.equal(dashboard.counts.stores, 1);
    assert.equal(dashboard.counts.activeEmployees, 0);
    assert.ok(dashboard.recentAuditEvents.some((event) => event.action === 'employee.offboarded'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
