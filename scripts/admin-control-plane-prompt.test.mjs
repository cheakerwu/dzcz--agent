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
const { AdminControlPlaneService } = require('../dist-electron/main/admin-control-plane/service.js');

test('prompt context excludes browser secrets and only includes active scoped memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-admin-prompt-'));

  try {
    const db = new Database(join(dir, 'prompt.db'));
    const service = new AdminControlPlaneService(db);
    service.ensureSchema();

    const store = service.createStore({
      name: '万达店',
      brand: '点之出众',
      city: '杭州',
      area: '滨江',
      status: 'operating',
    }, 'admin');
    const conversation = service.upsertFeishuConversation({
      connectorId: 'feishu',
      conversationId: 'oc_2',
      chatType: 'group',
      name: '万达运营群',
      status: 'active',
    }, 'admin');

    service.bindConversationToStore({
      conversationId: conversation.id,
      storeId: store.id,
    }, 'admin');
    service.createMemoryItem({
      scope: 'store',
      category: 'campaign',
      content: '万达店周三主推套餐 A。',
      status: 'active',
      confidence: 0.9,
      entityLinks: [{ entityType: 'store', entityId: store.id }],
    }, 'admin');
    service.createMemoryItem({
      scope: 'store',
      category: 'old',
      content: '这条归档记忆不应进入提示词。',
      status: 'archived',
      confidence: 0.2,
      entityLinks: [{ entityType: 'store', entityId: store.id }],
    }, 'admin');
    service.createBrowserProfile({
      platform: 'eleme',
      label: '万达饿了么',
      storeId: store.id,
      storageStateRef: 'token=abc123',
      status: 'healthy',
      riskLevel: 'high',
      allowedActionLevel: 'read_only',
    }, 'admin');

    const context = service.buildPromptContextForConnectorSession({
      connectorId: 'feishu',
      conversationId: 'oc_2',
    });
    assert.match(context, /万达店周三主推套餐 A/);
    assert.doesNotMatch(context, /归档记忆/);
    assert.doesNotMatch(context, /token=abc123/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
