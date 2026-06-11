import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

execFileSync('pnpm', ['run', 'build:main'], { cwd: root, stdio: 'inherit' });

const {
  isValidFeishuAppId,
  describeFeishuConnectionStatus,
} = require('../dist-electron/main/connectors/feishu/feishu-connector.js');

test('feishu app id validation matches SDK long connection requirements', () => {
  assert.equal(isValidFeishuAppId('cli_1234567890abcdef'), true);
  assert.equal(isValidFeishuAppId('cli_1234567890abcdeg'), false);
  assert.equal(isValidFeishuAppId('cli_123'), false);
  assert.equal(isValidFeishuAppId(''), false);
});

test('feishu connection status message exposes reconnect attempts', () => {
  const message = describeFeishuConnectionStatus({
    state: 'reconnecting',
    reconnectAttempts: 2,
  });

  assert.match(message, /重连中/);
  assert.match(message, /2/);
});
