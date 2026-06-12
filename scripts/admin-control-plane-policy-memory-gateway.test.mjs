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
const { PolicyService } = require('../dist-electron/main/domains/admin-control-plane/policy-service.js');
const { MemoryGateway } = require('../dist-electron/main/domains/admin-control-plane/memory-gateway.js');

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-policy-memory-'));
  const db = new Database(join(dir, 'policy-memory.db'));
  const service = new AdminControlPlaneService(db);
  service.ensureSchema();

  const store = service.createStore({
    name: '趣东北·东北小馆(石岩店)',
    brand: '趣东北',
    city: '深圳',
    area: '石岩',
    status: 'operating',
  }, 'admin');
  const otherStore = service.createStore({
    name: '别的门店',
    brand: '趣东北',
    city: '深圳',
    area: '南山',
    status: 'operating',
  }, 'admin');

  const employee = service.upsertEmployee({
    connectorId: 'feishu',
    userId: 'ou_active',
    openId: 'ou_open_active',
    displayName: '用户_721b3c14',
    role: 'operator',
    status: 'active',
  }, 'admin');
  const otherEmployee = service.upsertEmployee({
    connectorId: 'feishu',
    userId: 'ou_other',
    displayName: '别的员工',
    role: 'operator',
    status: 'active',
  }, 'admin');

  const conversation = service.upsertFeishuConversation({
    connectorId: 'feishu',
    conversationId: 'oc_test3',
    chatType: 'group',
    name: '测试3',
    status: 'active',
  }, 'admin');
  const otherConversation = service.upsertFeishuConversation({
    connectorId: 'feishu',
    conversationId: 'oc_other',
    chatType: 'group',
    name: '别的群',
    status: 'active',
  }, 'admin');

  service.bindConversationToStore({
    conversationId: conversation.id,
    storeId: store.id,
  }, 'admin');
  service.bindConversationToStore({
    conversationId: otherConversation.id,
    storeId: otherStore.id,
  }, 'admin');

  service.createMemoryItem({
    scope: 'enterprise',
    category: 'reporting',
    content: '企业日报默认先看营业额。',
    status: 'active',
    confidence: 0.95,
  }, 'admin');
  service.createMemoryItem({
    scope: 'conversation',
    category: 'ops',
    content: '测试3群本周关注差评回复。',
    status: 'active',
    confidence: 0.92,
    entityLinks: [{ entityType: 'conversation', entityId: conversation.id }],
  }, 'admin');
  service.createMemoryItem({
    scope: 'store',
    category: 'ops',
    content: '石岩店午高峰要提前补打包袋。',
    status: 'active',
    confidence: 0.9,
    entityLinks: [{ entityType: 'store', entityId: store.id }],
  }, 'admin');
  service.createMemoryItem({
    scope: 'employee',
    category: 'preference',
    content: '用户喜欢先看预警。',
    status: 'active',
    confidence: 0.9,
    entityLinks: [{ entityType: 'employee', entityId: employee.id }],
  }, 'admin');
  service.createMemoryItem({
    scope: 'conversation',
    category: 'ops',
    content: '别的群记忆不应出现。',
    status: 'active',
    confidence: 0.9,
    entityLinks: [{ entityType: 'conversation', entityId: otherConversation.id }],
  }, 'admin');
  service.createMemoryItem({
    scope: 'employee',
    category: 'preference',
    content: '别的员工记忆不应出现。',
    status: 'active',
    confidence: 0.9,
    entityLinks: [{ entityType: 'employee', entityId: otherEmployee.id }],
  }, 'admin');
  service.createMemoryItem({
    scope: 'store',
    category: 'ops',
    content: '别的门店记忆不应出现。',
    status: 'active',
    confidence: 0.9,
    entityLinks: [{ entityType: 'store', entityId: otherStore.id }],
  }, 'admin');
  service.createBrowserProfile({
    platform: 'meituan',
    label: '石岩美团主账号',
    storeId: store.id,
    profilePath: '/secret/token=abc123/profile',
    storageStateRef: 'browser-act:chrome_local_1',
    status: 'healthy',
    riskLevel: 'high',
    allowedActionLevel: 'high_risk_write',
  }, 'admin');

  return {
    dir,
    service,
    policy: new PolicyService(db),
    gateway: new MemoryGateway(db),
    store,
    employee,
  };
}

test('policy and memory gateway expose only allowed enterprise, group, and personal memory', () => {
  const fixture = createFixture();

  try {
    const decision = fixture.policy.evaluateMemoryRead({
      connectorId: 'feishu',
      conversationId: 'oc_test3',
      actorUserId: 'ou_active',
      action: 'memory.read',
    });

    assert.equal(decision.effect, 'allow');
    assert.deepEqual(decision.allowedMemoryScopes, ['enterprise', 'conversation', 'employee']);
    assert.deepEqual(decision.allowedStoreIds, [fixture.store.id]);
    assert.equal(decision.actorEmployeeId, fixture.employee.id);
    assert.equal(decision.allowedBrowserProfileIds.length, 1);

    const context = fixture.gateway.buildPromptContext({
      connectorId: 'feishu',
      conversationId: 'oc_test3',
      actorUserId: 'ou_active',
    });

    assert.match(context, /会话: 测试3 \(group\)/);
    assert.match(context, /关联门店:/);
    assert.match(context, /趣东北·东北小馆\(石岩店\)/);
    assert.match(context, /### 企业记忆/);
    assert.match(context, /### 群聊记忆/);
    assert.match(context, /### 个人记忆/);
    assert.match(context, /企业日报默认先看营业额/);
    assert.match(context, /测试3群本周关注差评回复/);
    assert.match(context, /石岩店午高峰要提前补打包袋/);
    assert.match(context, /用户喜欢先看预警/);
    assert.match(context, /石岩美团主账号/);
    assert.match(context, /最高动作:high_risk_write/);
    assert.doesNotMatch(context, /别的群记忆/);
    assert.doesNotMatch(context, /别的员工记忆/);
    assert.doesNotMatch(context, /别的门店记忆/);
    assert.doesNotMatch(context, /token=abc123/);
    assert.doesNotMatch(context, /browser-act:/);
    assert.doesNotMatch(context, /chrome_local_1/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('personal memory is omitted for unknown or offboarded actors', () => {
  const fixture = createFixture();

  try {
    const anonymousDecision = fixture.policy.evaluateMemoryRead({
      connectorId: 'feishu',
      conversationId: 'oc_test3',
      action: 'memory.read',
    });

    assert.equal(anonymousDecision.effect, 'allow');
    assert.deepEqual(anonymousDecision.allowedMemoryScopes, ['enterprise', 'conversation']);

    const anonymousContext = fixture.gateway.buildPromptContext({
      connectorId: 'feishu',
      conversationId: 'oc_test3',
    });

    assert.match(anonymousContext, /### 企业记忆/);
    assert.match(anonymousContext, /### 群聊记忆/);
    assert.doesNotMatch(anonymousContext, /### 个人记忆/);
    assert.doesNotMatch(anonymousContext, /用户喜欢先看预警/);

    fixture.service.offboardEmployee(fixture.employee.id, 'admin');

    const offboardedDecision = fixture.policy.evaluateMemoryRead({
      connectorId: 'feishu',
      conversationId: 'oc_test3',
      actorUserId: 'ou_active',
      action: 'memory.read',
    });

    assert.equal(offboardedDecision.effect, 'allow');
    assert.deepEqual(offboardedDecision.allowedMemoryScopes, ['enterprise', 'conversation']);
    assert.equal(offboardedDecision.actorEmployeeId, undefined);

    const offboardedContext = fixture.gateway.buildPromptContext({
      connectorId: 'feishu',
      conversationId: 'oc_test3',
      actorUserId: 'ou_active',
    });

    assert.doesNotMatch(offboardedContext, /### 个人记忆/);
    assert.doesNotMatch(offboardedContext, /用户喜欢先看预警/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('unknown conversations are denied by policy and produce no prompt context', () => {
  const fixture = createFixture();

  try {
    const decision = fixture.policy.evaluateMemoryRead({
      connectorId: 'feishu',
      conversationId: 'oc_missing',
      actorUserId: 'ou_active',
      action: 'memory.read',
    });

    assert.equal(decision.effect, 'deny');
    assert.deepEqual(decision.allowedMemoryScopes, []);
    assert.deepEqual(decision.allowedStoreIds, []);

    const context = fixture.gateway.buildPromptContext({
      connectorId: 'feishu',
      conversationId: 'oc_missing',
      actorUserId: 'ou_active',
    });

    assert.equal(context, '');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

