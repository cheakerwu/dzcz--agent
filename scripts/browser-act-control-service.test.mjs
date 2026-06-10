import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseBrowserActBrowserList,
  parseBrowserActProfileList,
  extractRemoteAssistUrl,
} = require('../dist-electron/main/browser-act/browser-act-parser.js');

const {
  BrowserActControlService,
  classifyRiskAccount,
} = require('../dist-electron/main/browser-act/browser-act-control-service.js');

const {
  verifyMeituanMerchantLogin,
  getLoginVerifier,
} = require('../dist-electron/main/browser-act/browser-act-login-verifiers.js');

class FakeRunner {
  constructor() {
    this.calls = [];
  }

  async run(args) {
    this.calls.push(args);
    if (args.join(' ') === 'browser list') {
      return 'id=chrome_local_1 name="meituan-merchant" type=chrome state=idle\n  desc="美团商家后台操作"';
    }
    if (args.join(' ') === 'browser list-profiles') {
      return '  local_profile_1 您的 Chrome     local      -                              Chrome\n  browser:chrome_local_1 meituan-merchant managed - meituan-merchant';
    }
    if (args.includes('remote-assist')) {
      return 'Remote assist URL: https://assist.browseract.local/session/login_req_1';
    }
    if (args.join(' ') === '--session login_req_1 eval location.href') {
      return 'https://ecom.meituan.com/shop/dashboard';
    }
    if (args.join(' ') === '--session login_req_1 get title') {
      return '美团商家中心';
    }
    if (args.join(' ') === '--session login_req_1 get markdown') {
      return '经营数据 门店管理 商品管理 订单管理';
    }
    return '';
  }
}

async function main() {
  const browsers = parseBrowserActBrowserList('id=chrome_local_1 name="meituan-merchant" type=chrome state=idle\n  desc="美团商家后台操作"');
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
  await service.listBrowsers();
  await service.listProfiles();
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

  const sessionVerification = await service.verifyLogin({
    sessionName: 'login_req_1',
    platform: 'meituan',
  });
  assert.equal(sessionVerification.healthy, true);
  assert.match(sessionVerification.evidence.join('\n'), /美团商家后台/);
  assert.deepEqual(runner.calls[4], ['--session', 'login_req_1', 'eval', 'location.href']);
  assert.deepEqual(runner.calls[5], ['--session', 'login_req_1', 'get', 'title']);
  assert.deepEqual(runner.calls[6], ['--session', 'login_req_1', 'get', 'markdown']);

  assert.equal(classifyRiskAccount({ platform: 'meituan', canChangePrice: true }), 'high_risk');
  assert.equal(classifyRiskAccount({ platform: 'meituan', canChangeBankOrInvoice: true }), 'critical');

  const loggedIn = verifyMeituanMerchantLogin({
    url: 'https://ecom.meituan.com/shop/dashboard',
    title: '美团商家中心',
    text: '经营数据 门店管理 商品管理 订单管理',
  });
  assert.equal(loggedIn.healthy, true);
  assert.match(loggedIn.evidence.join('\n'), /美团商家后台/);

  const loginPage = verifyMeituanMerchantLogin({
    url: 'https://ecom.meituan.com/account/login',
    title: '美团账号登录',
    text: '账号登录 手机验证码登录 请输入手机号',
  });
  assert.equal(loginPage.healthy, false);
  assert.match(loginPage.reason, /仍在登录页/);

  assert.equal(getLoginVerifier('美团'), verifyMeituanMerchantLogin);
}

test('browser-act parser and control service build deterministic commands', async () => {
  await main();
});
