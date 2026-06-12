import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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

function createToolWithFakeBinary(tempRoot) {
  const { browserActToolPlugin } = require('../dist-electron/main/domains/tools/browser-act-tool.js');
  const workspaceDir = join(tempRoot, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  return browserActToolPlugin.create({
    workspaceDir,
    sessionId: `browser-act-confirmation-${Date.now()}`,
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

async function loadGuide(tool) {
  const result = await tool.execute('guide', {
    args: ['get-skills', 'core', '--skill-version', '2.0.2'],
  });
  assert.equal(result.isError, false);
}

test('browser-act write-like commands require an approved Feishu confirmation before execution', async () => {
  const {
    globalFeishuConfirmationStore,
  } = require('../dist-electron/main/domains/connectors/feishu/confirmation-card.js');

  const tempRoot = mkdtempSync(join(tmpdir(), 'browser-act-confirmation-'));
  const previousBin = process.env.BROWSER_ACT_BIN;
  const previousCalls = process.env.FAKE_BROWSER_ACT_CALLS;
  const { binPath, callsPath } = createFakeBrowserActBinary(tempRoot);

  process.env.BROWSER_ACT_BIN = binPath;
  process.env.FAKE_BROWSER_ACT_CALLS = callsPath;

  try {
    const tool = createToolWithFakeBinary(tempRoot);
    await loadGuide(tool);

    const blocked = await tool.execute('write-without-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
    });

    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /飞书确认|feishu_confirmation|confirmationPlanId/);
    assert.equal(blocked.details.confirmationRequired, true);
    assert.deepEqual(readFakeBrowserActCalls(callsPath), [
      ['get-skills', 'core', '--skill-version', '2.0.2'],
    ]);

    globalFeishuConfirmationStore.create({
      planId: 'pending_browser_write',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
    });

    const pending = await tool.execute('write-with-pending-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
      confirmationPlanId: 'pending_browser_write',
    });

    assert.equal(pending.isError, true);
    assert.match(pending.content[0].text, /尚未确认|pending|等待确认/);
    assert.equal(pending.details.confirmationStatus, 'pending');

    globalFeishuConfirmationStore.create({
      planId: 'rejected_browser_write',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
    });
    globalFeishuConfirmationStore.reject('rejected_browser_write', {
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

    globalFeishuConfirmationStore.create({
      planId: 'approved_browser_write',
      title: '保存门店资料',
      summary: '点击保存按钮',
      riskLevel: 'high',
    });
    globalFeishuConfirmationStore.approve('approved_browser_write', {
      operatorId: 'ou_reviewer',
      operatorName: 'Reviewer',
    });

    const approved = await tool.execute('write-with-approved-confirmation', {
      args: ['--session', 'merchant-demo', 'click', 'button:保存'],
      confirmationPlanId: 'approved_browser_write',
    });

    assert.equal(approved.isError, false);
    assert.equal(approved.details.confirmationStatus, 'approved');
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
