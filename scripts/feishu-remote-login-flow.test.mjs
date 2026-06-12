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
const { BrowserActControlService } = require('../dist-electron/main/domains/browser-act/browser-act-control-service.js');
const { FeishuLoginCommandHandler } = require('../dist-electron/main/domains/connectors/feishu/login-command-handler.js');
const {
  startBrowserActLoginRequest,
  completeBrowserActLoginRequest,
} = require('../dist-electron/main/domains/connectors/feishu/browser-act-login-flow.js');

class FakeBrowserActRunner {
  constructor() {
    this.calls = [];
  }

  async run(args) {
    this.calls.push(args);
    if (args.join(' ') === 'browser list') {
      return 'id=chrome_mt name="meituan-merchant" type=chrome state=idle\n  desc="望京店 美团商家后台"';
    }
    if (args.includes('remote-assist')) {
      return 'Remote assist URL: https://assist.browseract.local/session/login_req_flow';
    }
    if (args[0] === '--session' && args[2] === 'eval' && args[3] === 'location.href') {
      return 'https://ecom.meituan.com/shop/dashboard';
    }
    if (args[0] === '--session' && args[2] === 'get' && args[3] === 'title') {
      return '美团商家中心';
    }
    if (args[0] === '--session' && args[2] === 'get' && args[3] === 'markdown') {
      return '经营数据 门店管理 商品管理 订单管理';
    }
    return '';
  }
}

class RemoteAssistFailureRunner extends FakeBrowserActRunner {
  async run(args) {
    this.calls.push(args);
    if (args.join(' ') === 'browser list') {
      return 'id=chrome_mt name="meituan-merchant" type=chrome state=idle\n  desc="望京店 美团商家后台"';
    }
    if (args.includes('remote-assist')) {
      throw new Error('remote assist relay unavailable');
    }
    return '';
  }
}

test('feishu remote assist login flow registers a verified browser-act profile without exposing storage state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-remote-login-flow-'));

  try {
    const db = new Database(join(dir, 'flow.db'));
    const service = new AdminControlPlaneService(db);
    service.ensureSchema();
    const store = service.createStore({
      name: '望京店',
      brand: '点之出众',
      city: '北京',
      area: '朝阳',
      status: 'operating',
    }, 'test');
    const platformAccount = service.createPlatformAccount({
      platform: 'meituan',
      label: '望京店美团运营账号',
      storeId: store.id,
      accountRef: 'mt-wangjing-main',
      riskAccountClass: 'high_risk',
    }, 'test');
    const conversation = service.upsertFeishuConversation({
      connectorId: 'feishu',
      conversationId: 'oc_group_1',
      chatType: 'group',
      name: '望京店运营群',
      status: 'active',
    }, 'test');
    service.bindConversationToStore({
      conversationId: conversation.id,
      storeId: store.id,
    }, 'test');

    const runner = new FakeBrowserActRunner();
    const browserAct = new BrowserActControlService({ runner, workspaceDir: root });
    const sentMessages = [];
    const handler = new FeishuLoginCommandHandler({
      sendMessage: async (message) => sentMessages.push(message),
      startLogin: (input) => startBrowserActLoginRequest({
        service,
        browserAct,
        input,
        actorId: 'flow-test',
      }),
      completeLogin: (input) => completeBrowserActLoginRequest({
        service,
        browserAct,
        requestCode: input.requestCode,
        requesterUserId: input.requesterUserId,
        requesterOpenId: input.requesterOpenId,
        actorId: 'flow-test',
      }),
    });

    const started = await handler.handle(
      { kind: 'start', platform: '美团', storeName: '望京店' },
      {
        sender: { id: 'ou_1', name: '小王' },
        conversation: { id: 'oc_group_1', type: 'group' },
        content: { type: 'text', text: '/login 美团 望京店' },
        raw: { sender: { sender_id: { open_id: 'ou_open_1' } } },
      },
    );

    assert.equal(started, true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].conversationId, 'ou_open_1');
    assert.equal(sentMessages[0]._receiveIdType, 'open_id');
    assert.match(sentMessages[0].content, /只发给你本人/);
    assert.match(sentMessages[0].content, /10 分钟/);
    assert.match(sentMessages[0].content, /https:\/\/assist\.browseract\.local\/session\/login_req_flow/);

    const loginRequest = service.listBrowserLoginRequests()[0];
    assert.equal(loginRequest.status, 'waiting_employee_login');
    assert.equal(loginRequest.platformAccountId, platformAccount.id);
    assert.equal(loginRequest.browserActBrowserId, 'chrome_mt');
    assert.equal(loginRequest.expiresAt - loginRequest.createdAt, 10 * 60 * 1000);

    const completed = await handler.handle(
      { kind: 'done', requestCode: loginRequest.id },
      {
        sender: { id: 'ou_1', name: '小王' },
        conversation: { id: 'oc_group_1', type: 'group' },
        content: { type: 'text', text: `/login-done ${loginRequest.id}` },
        raw: { sender: { sender_id: { open_id: 'ou_open_1' } } },
      },
    );

    assert.equal(completed, true);
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[1].content, /登录态已登记/);

    const healthyRequest = service.getBrowserLoginRequest(loginRequest.id);
    assert.equal(healthyRequest.status, 'healthy');
    assert.ok(healthyRequest.browserProfileId);
    assert.ok(healthyRequest.verifiedAt);

    const profile = service.listBrowserProfiles()[0];
    assert.equal(profile.storageStateRef, 'browser-act:chrome_mt');
    assert.equal(profile.allowedActionLevel, 'high_risk_write');
    assert.equal(profile.riskLevel, 'high');
    assert.ok(
      runner.calls.some((args) => args.join(' ') === `session close ${loginRequest.sessionName}`),
      'successful login completion should close the browser-act session',
    );

    const promptContext = service.buildPromptContextForConnectorSession({
      connectorId: 'feishu',
      conversationId: 'oc_group_1',
    });
    assert.match(promptContext, /望京店meituan登录态/);
    assert.match(promptContext, /high_risk_write/);
    assert.doesNotMatch(promptContext, /browser-act:chrome_mt/);
    assert.doesNotMatch(promptContext, /chrome_mt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remote assist startup failure marks request failed and closes temporary session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dianbot-remote-login-failure-'));

  try {
    const db = new Database(join(dir, 'flow.db'));
    const service = new AdminControlPlaneService(db);
    service.ensureSchema();
    const store = service.createStore({
      name: '望京店',
      brand: '点之出众',
      city: '北京',
      area: '朝阳',
      status: 'operating',
    }, 'test');
    service.createPlatformAccount({
      platform: 'meituan',
      label: '望京店美团运营账号',
      storeId: store.id,
      accountRef: 'mt-wangjing-main',
      riskAccountClass: 'high_risk',
    }, 'test');

    const runner = new RemoteAssistFailureRunner();
    const browserAct = new BrowserActControlService({ runner, workspaceDir: root });

    await assert.rejects(
      () => startBrowserActLoginRequest({
        service,
        browserAct,
        input: {
          platform: '美团',
          storeName: '望京店',
          requesterUserId: 'ou_1',
          requesterOpenId: 'ou_open_1',
          requesterName: '小王',
          conversationId: 'oc_group_1',
          conversationType: 'group',
        },
        actorId: 'flow-test',
      }),
      /remote assist relay unavailable/,
    );

    const loginRequest = service.listBrowserLoginRequests()[0];
    assert.equal(loginRequest.status, 'failed');
    assert.equal(loginRequest.browserActBrowserId, undefined);
    assert.match(loginRequest.failedReason || '', /remote assist relay unavailable/);
    assert.equal(service.listBrowserProfiles().length, 0);
    assert.ok(
      runner.calls.some((args) => args.join(' ') === `session close ${loginRequest.sessionName}`),
      'failed remote assist startup should close the temporary browser-act session',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
