import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function createFakeBrowserActBinary(tempRoot) {
  const binPath = join(tempRoot, 'fake-browser-act');
  const callsPath = join(tempRoot, 'browser-act-calls.jsonl');
  writeFileSync(binPath, `#!/usr/bin/env node
const fs = require('node:fs');
const callsPath = process.env.FAKE_BROWSER_ACT_CALLS;
const args = process.argv.slice(2);
fs.appendFileSync(callsPath, JSON.stringify(args) + '\\n');
if (args[0] === 'get-skills') {
  console.log('BrowserAct guide loaded');
  process.exit(0);
}
console.log('BrowserAct command executed: ' + args.join(' '));
`, 'utf8');
  chmodSync(binPath, 0o755);
  return { binPath, callsPath };
}

function readFakeBrowserActCalls(callsPath) {
  try {
    const lines = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function createBrowserActExecutionBinding(args) {
  return {
    toolName: 'browser_act',
    signature: createHash('sha256')
      .update(JSON.stringify({ toolName: 'browser_act', args }))
      .digest('hex'),
    summary: args.join(' '),
  };
}

function createToolWithFakeBinary(tempRoot, dependencies = {}) {
  const { browserActToolPlugin } = require('../dist-electron/main/domains/tools/browser-act-tool.js');
  const workspaceDir = join(tempRoot, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  return browserActToolPlugin.create({
    workspaceDir,
    sessionId: `browser-act-confirmation-${Date.now()}`,
    dependencies,
    configStore: {
      getWorkspaceSettings() {
        return {
          workspaceDir,
          imageDir: join(tempRoot, 'images'),
        };
      },
    },
  });
}

function createIsolatedFeishuConfirmationDependencies(tempRoot) {
  const { default: Database } = require('../dist-electron/shared/utils/sqlite-adapter.js');
  const {
    createFeishuConfirmationStore,
  } = require('../dist-electron/main/domains/connectors/feishu/confirmation-card.js');
  const {
    FeishuConfirmationAuditStore,
  } = require('../dist-electron/main/domains/connectors/feishu/confirmation-audit-store.js');

  const db = new Database(join(tempRoot, 'audit.db'));
  const auditStore = new FeishuConfirmationAuditStore(db);
  auditStore.ensureSchema();
  return {
    db,
    auditStore,
    confirmationStore: createFeishuConfirmationStore({ auditStore }),
  };
}

async function loadGuide(tool) {
  const result = await tool.execute('guide', {
    args: ['get-skills', 'core', '--skill-version', '2.0.2'],
  });
  assert.equal(result.isError, false);
}

test('browser-act write-like commands require an approved Feishu confirmation before execution', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-confirmation-'));
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousCalls = process.env.FAKE_BROWSER_ACT_CALLS;
  const { binPath, callsPath } = createFakeBrowserActBinary(tempRoot);

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_CALLS = callsPath;

  try {
    const {
      auditStore: confirmationAuditStore,
      confirmationStore,
    } = createIsolatedFeishuConfirmationDependencies(tempRoot);
    const tool = createToolWithFakeBinary(tempRoot, { confirmationStore, confirmationAuditStore });
    await loadGuide(tool);

    const blocked = await tool.execute('write-without-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
    });

    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /飞书确认|feishu_confirmation|confirmationPlanId/);
    assert.equal(blocked.details.confirmationRequired, true);
    assert.ok(blocked.details.requiredConfirmationBinding);
    assert.equal(blocked.details.requiredConfirmationBinding.toolName, 'browser_act');
    assert.equal(blocked.details.requiredConfirmationBinding.signature, createBrowserActExecutionBinding([
      '--session',
      'merchant-demo',
      'click',
      'button:保存',
    ]).signature);
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
    ]);

    confirmationStore.create({
      planId: 'pending_browser_write',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
      executionBinding: createBrowserActExecutionBinding(['--session', 'merchant-demo', 'click', 'button:保存']),
    });

    const pending = await tool.execute('write-with-pending-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
      confirmationPlanId: 'pending_browser_write',
    });

    assert.equal(pending.isError, true);
    assert.match(pending.content[0].text, /尚未确认|pending|等待确认/);
    assert.equal(pending.details.confirmationStatus, 'pending');

    confirmationStore.create({
      planId: 'rejected_browser_write',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
      executionBinding: createBrowserActExecutionBinding(['--session', 'merchant-demo', 'click', 'button:保存']),
    });
    confirmationStore.reject('rejected_browser_write', {
      operatorId: 'ou_reviewer',
      operatorName: 'Reviewer',
    });

    const rejected = await tool.execute('write-with-rejected-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
      confirmationPlanId: 'rejected_browser_write',
    });

    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /已取消|rejected|拒绝/);
    assert.equal(rejected.details.confirmationStatus, 'rejected');

    confirmationStore.create({
      planId: 'approved_browser_write',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
      executionBinding: createBrowserActExecutionBinding(['--session', 'merchant-demo', 'click', 'button:保存']),
    });
    confirmationStore.approve('approved_browser_write', {
      operatorId: 'ou_reviewer',
      operatorName: 'Reviewer',
    });

    const approved = await tool.execute('write-with-approved-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
      confirmationPlanId: 'approved_browser_write',
    });

    assert.equal(approved.isError, false);
    assert.equal(approved.details.confirmationStatus, 'approved');
    assert.deepEqual(approved.details.executionBinding, createBrowserActExecutionBinding([
      '--session',
      'merchant-demo',
      'click',
      'button:保存',
    ]));
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
      ['--session', 'merchant-demo', 'click', 'button:保存'],
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.BROWSER_ACT_BIN;
    } else {
      process.env.BROWSER_ACT_BIN = previousBin;
    }
    if (previousCalls === undefined) {
      delete process.env.FAKE_BROWSER_ACT_CALLS;
    } else {
      process.env.FAKE_BROWSER_ACT_CALLS = previousCalls;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('browser-act approved confirmations are bound to the exact write command', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-confirmation-binding-'));
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousCalls = process.env.FAKE_BROWSER_ACT_CALLS;
  const { binPath, callsPath } = createFakeBrowserActBinary(tempRoot);

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_CALLS = callsPath;

  try {
    const {
      auditStore: confirmationAuditStore,
      confirmationStore,
    } = createIsolatedFeishuConfirmationDependencies(tempRoot);
    const tool = createToolWithFakeBinary(tempRoot, { confirmationStore, confirmationAuditStore });
    await loadGuide(tool);

    confirmationStore.create({
      planId: 'approved_save_only',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
      executionBinding: createBrowserActExecutionBinding(['--session', 'merchant-demo', 'click', 'button:保存']),
    });
    confirmationStore.approve('approved_save_only', {
      operatorId: 'ou_reviewer',
      operatorName: 'Reviewer',
    });

    const mismatched = await tool.execute('write-with-mismatched-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:发布'],
      confirmationPlanId: 'approved_save_only',
    });

    assert.equal(mismatched.isError, true);
    assert.match(mismatched.content[0].text, /不匹配|重新确认|executionBinding/);
    assert.equal(mismatched.details.confirmationStatus, 'approved');
    assert.equal(mismatched.details.confirmationBindingMatched, false);
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.BROWSER_ACT_BIN;
    } else {
      process.env.BROWSER_ACT_BIN = previousBin;
    }
    if (previousCalls === undefined) {
      delete process.env.FAKE_BROWSER_ACT_CALLS;
    } else {
      process.env.FAKE_BROWSER_ACT_CALLS = previousCalls;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('browser-act writes execution result back to the confirmation audit record', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-confirmation-exec-audit-'));
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousCalls = process.env.FAKE_BROWSER_ACT_CALLS;
  const { binPath, callsPath } = createFakeBrowserActBinary(tempRoot);

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_CALLS = callsPath;

  try {
    const { db, auditStore, confirmationStore } = createIsolatedFeishuConfirmationDependencies(tempRoot);
    const writeArgs = ['--session', 'merchant-demo', 'click', 'button:保存'];

    confirmationStore.create({
      planId: 'approved_with_execution_audit',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
      executionBinding: createBrowserActExecutionBinding(writeArgs),
    });
    confirmationStore.approve('approved_with_execution_audit', {
      operatorId: 'ou_reviewer',
      operatorName: 'Reviewer',
      decidedAt: 2000,
    });

    const tool = createToolWithFakeBinary(tempRoot, { confirmationStore, confirmationAuditStore: auditStore });
    await loadGuide(tool);

    const result = await tool.execute('write-with-execution-audit', {
      args: writeArgs,
      confirmationPlanId: 'approved_with_execution_audit',
    });

    assert.equal(result.isError, false);
    const persisted = auditStore.get('approved_with_execution_audit');
    assert.equal(persisted.executionStatus, 'completed');
    assert.equal(persisted.executionToolName, 'browser_act');
    assert.equal(persisted.executionExitCode, 0);
    assert.equal(persisted.executionError, undefined);
    assert.match(persisted.executionStdoutPreview, /BrowserAct command executed/);

    const auditEvents = db.prepare(`
      SELECT action, entity_id, changes_json
      FROM audit_events
      WHERE entity_type = 'feishu_confirmation'
      ORDER BY created_at ASC
    `).all();
    assert.ok(auditEvents.some((event) => (
      event.action === 'feishu_confirmation.execution_completed'
      && event.entity_id === 'approved_with_execution_audit'
      && /BrowserAct command executed/.test(event.changes_json)
    )));
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
      writeArgs,
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.BROWSER_ACT_BIN;
    } else {
      process.env.BROWSER_ACT_BIN = previousBin;
    }
    if (previousCalls === undefined) {
      delete process.env.FAKE_BROWSER_ACT_CALLS;
    } else {
      process.env.FAKE_BROWSER_ACT_CALLS = previousCalls;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('browser-act updates the original Feishu confirmation card with execution result', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-confirmation-card-update-'));
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousCalls = process.env.FAKE_BROWSER_ACT_CALLS;
  const { binPath, callsPath } = createFakeBrowserActBinary(tempRoot);
  const updatedCards = [];

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_CALLS = callsPath;

  try {
    const { auditStore, confirmationStore } = createIsolatedFeishuConfirmationDependencies(tempRoot);
    const writeArgs = ['--session', 'merchant-demo', 'click', 'button:保存'];

    confirmationStore.create({
      planId: 'approved_with_card_update',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
      messageId: 'om_confirmation_card',
      executionBinding: createBrowserActExecutionBinding(writeArgs),
    });
    confirmationStore.approve('approved_with_card_update', {
      operatorId: 'ou_reviewer',
      operatorName: 'Reviewer',
      decidedAt: 2000,
    });

    const tool = createToolWithFakeBinary(tempRoot, {
      confirmationStore,
      confirmationAuditStore: auditStore,
      updateFeishuInteractiveCard: async (messageId, card) => {
        updatedCards.push({ messageId, card });
      },
    });
    await loadGuide(tool);

    const result = await tool.execute('write-with-execution-card-update', {
      args: writeArgs,
      confirmationPlanId: 'approved_with_card_update',
    });

    assert.equal(result.isError, false);
    assert.equal(updatedCards.length, 1);
    assert.equal(updatedCards[0].messageId, 'om_confirmation_card');
    const cardBody = JSON.stringify(updatedCards[0].card);
    assert.match(updatedCards[0].card.header.title.content, /执行完成/);
    assert.match(cardBody, /BrowserAct command executed/);
    assert.match(cardBody, /browser_act/);
    assert.doesNotMatch(cardBody, /feishu_confirmation_approve/);
    assert.doesNotMatch(cardBody, /feishu_confirmation_reject/);
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
      writeArgs,
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.BROWSER_ACT_BIN;
    } else {
      process.env.BROWSER_ACT_BIN = previousBin;
    }
    if (previousCalls === undefined) {
      delete process.env.FAKE_BROWSER_ACT_CALLS;
    } else {
      process.env.FAKE_BROWSER_ACT_CALLS = previousCalls;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('browser-act read-only commands do not require Feishu confirmation', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-confirmation-readonly-'));
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousCalls = process.env.FAKE_BROWSER_ACT_CALLS;
  const { binPath, callsPath } = createFakeBrowserActBinary(tempRoot);

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_CALLS = callsPath;

  try {
    const tool = createToolWithFakeBinary(tempRoot);
    await loadGuide(tool);

    const result = await tool.execute('readonly-screenshot', {
      args: ['--session', 'merchant-demo', 'screenshot'],
    });

    assert.equal(result.isError, false);
    assert.notEqual(result.details.confirmationRequired, true);
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
      ['--session', 'merchant-demo', 'screenshot'],
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.BROWSER_ACT_BIN;
    } else {
      process.env.BROWSER_ACT_BIN = previousBin;
    }
    if (previousCalls === undefined) {
      delete process.env.FAKE_BROWSER_ACT_CALLS;
    } else {
      process.env.FAKE_BROWSER_ACT_CALLS = previousCalls;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
