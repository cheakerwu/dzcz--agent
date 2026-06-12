import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseLoginCommand,
  formatLoginRequestPrivateMessage,
  FeishuLoginCommandHandler,
} = require('../dist-electron/main/domains/connectors/feishu/login-command-handler.js');
const {
  resolveMerchantLoginPlatform,
  selectBrowserActBrowserForLogin,
} = require('../dist-electron/main/domains/connectors/feishu/login-platforms.js');

test('feishu login command parser recognizes login lifecycle commands', () => {
  const start = parseLoginCommand('/login 美团 望京店');
  assert.equal(start.kind, 'start');
  assert.equal(start.platform, '美团');
  assert.equal(start.storeName, '望京店');

  const done = parseLoginCommand('/login-done abc123');
  assert.equal(done.kind, 'done');
  assert.equal(done.requestCode, 'abc123');

  const cancel = parseLoginCommand('/login-cancel abc123');
  assert.equal(cancel.kind, 'cancel');
  assert.equal(cancel.requestCode, 'abc123');

  const status = parseLoginCommand('/login-status abc123');
  assert.equal(status.kind, 'status');
  assert.equal(status.requestCode, 'abc123');

  assert.equal(parseLoginCommand('普通消息'), null);
});

test('feishu login request private message keeps remote assist employee-only', () => {
  const privateMessage = formatLoginRequestPrivateMessage({
    platform: '美团',
    storeName: '望京店',
    expiresAt: new Date('2026-06-10T10:10:00.000Z').getTime(),
    remoteAssistUrl: 'https://assist.example/login',
  });
  assert.match(privateMessage, /只发给你本人/);
  assert.match(privateMessage, /10 分钟/);
  assert.match(privateMessage, /https:\/\/assist\.example\/login/);
});

test('feishu login handler sends remote assist links through open_id private message', async () => {
  const sentMessages = [];
  const handler = new FeishuLoginCommandHandler({
    sendMessage: async (message) => {
      sentMessages.push(message);
    },
    startLogin: async () => ({
      requestCode: 'loginreq_1',
      expiresAt: Date.now() + 10 * 60 * 1000,
      remoteAssistUrl: 'https://assist.example/loginreq_1',
    }),
  });

  const handled = await handler.handle(
    { kind: 'start', platform: '美团', storeName: '望京店' },
    {
      sender: { id: 'ou_1', name: '小王' },
      conversation: { id: 'oc_group_1', type: 'group' },
      content: { type: 'text', text: '/login 美团 望京店' },
      raw: { sender: { sender_id: { open_id: 'ou_open_1' } } },
    },
  );

  assert.equal(handled, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].conversationId, 'ou_open_1');
  assert.equal(sentMessages[0]._receiveIdType, 'open_id');
  assert.match(sentMessages[0].content, /只发给你本人/);
});

test('feishu login platform resolver only enables meituan in the first rollout', () => {
  const meituan = resolveMerchantLoginPlatform('美团');
  assert.equal(meituan.platform, 'meituan');
  assert.equal(meituan.loginUrl, 'https://ecom.meituan.com/');

  assert.throws(
    () => resolveMerchantLoginPlatform('饿了么'),
    /暂不支持.*饿了么/,
  );
  assert.throws(
    () => resolveMerchantLoginPlatform('unknown-platform'),
    /暂不支持.*unknown-platform/,
  );
});

test('feishu login browser selector requires an explicit semantic match', () => {
  const matched = selectBrowserActBrowserForLogin({
    platform: 'meituan',
    storeName: '望京店',
    browsers: [
      { id: 'chrome_other', name: 'generic', type: 'chrome', desc: '普通浏览器' },
      { id: 'chrome_mt', name: 'meituan-merchant', type: 'chrome', desc: '望京店 美团商家后台' },
    ],
  });
  assert.equal(matched.id, 'chrome_mt');

  assert.throws(
    () => selectBrowserActBrowserForLogin({
      platform: 'meituan',
      storeName: '望京店',
      browsers: [
        { id: 'chrome_other', name: 'generic', type: 'chrome', desc: '普通浏览器' },
        { id: 'chrome_ops', name: 'ops', type: 'chrome', desc: '运营后台' },
      ],
    }),
    /没有明确匹配/,
  );
});
