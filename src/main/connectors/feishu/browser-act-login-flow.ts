import { getErrorMessage } from '../../../shared/utils/error-handler';
import type { BrowserActionLevel, BrowserLoginRequest, RiskLevel } from '../../../types/admin-control-plane';
import { AdminControlPlaneService } from '../../admin-control-plane/service';
import { BrowserActControlService } from '../../browser-act/browser-act-control-service';
import type { LoginRequestStartResult } from './login-command-handler';
import { resolveMerchantLoginPlatform, selectBrowserActBrowserForLogin } from './login-platforms';

export interface FeishuRemoteLoginStartInput {
  platform: string;
  storeName: string;
  requesterUserId: string;
  requesterOpenId?: string;
  requesterName?: string;
  conversationId: string;
  conversationType: 'p2p' | 'group';
}

export async function startBrowserActLoginRequest(options: {
  service: AdminControlPlaneService;
  browserAct: BrowserActControlService;
  input: FeishuRemoteLoginStartInput;
  actorId?: string;
}): Promise<LoginRequestStartResult> {
  const { service, browserAct, input, actorId = 'feishu-login' } = options;
  service.ensureSchema();
  service.expireBrowserLoginRequests();

  const platformConfig = resolveMerchantLoginPlatform(input.platform);
  const platform = platformConfig.platform;
  const store = service.listStores().find((item) => item.name === input.storeName || item.name.includes(input.storeName));
  if (!store) throw new Error(`未找到门店：${input.storeName}`);

  let employee = service.listEmployees().find((item) =>
    item.connectorId === 'feishu' && (item.userId === input.requesterUserId || item.openId === input.requesterOpenId)
  );
  if (!employee) {
    employee = service.upsertEmployee({
      connectorId: 'feishu',
      userId: input.requesterUserId,
      openId: input.requesterOpenId,
      displayName: input.requesterName || input.requesterUserId,
      role: 'operator',
      status: 'active',
    }, actorId);
  }

  const platformAccount = service.listPlatformAccounts().find((account) =>
    account.platform === platform && (!account.storeId || account.storeId === store.id) && account.status === 'active'
  );
  const request = service.createBrowserLoginRequest({
    connectorId: 'feishu',
    requesterUserId: input.requesterUserId,
    requesterOpenId: input.requesterOpenId,
    employeeId: employee.id,
    storeId: store.id,
    platform,
    platformAccountId: platformAccount?.id,
    loginUrl: platformConfig.loginUrl,
  }, actorId);

  try {
    const browser = selectBrowserActBrowserForLogin({
      platform,
      storeName: input.storeName,
      browsers: await browserAct.listBrowsers(),
    });
    await browserAct.openBrowserForLogin({
      sessionName: request.sessionName,
      browserId: browser.id,
      url: request.loginUrl,
    });
    const remoteAssistUrl = await browserAct.createRemoteAssist({
      sessionName: request.sessionName,
      objective: `请登录${input.storeName}${input.platform}商家后台。不要分享密码、验证码或 cookie 给任何人。`,
    });
    service.markBrowserLoginRequestWaiting(request.id, browser.id, actorId);
    return {
      requestCode: request.id,
      expiresAt: request.expiresAt,
      remoteAssistUrl,
    };
  } catch (error) {
    service.markBrowserLoginRequestFailed(request.id, getErrorMessage(error), actorId);
    throw error;
  }
}

export async function completeBrowserActLoginRequest(options: {
  service: AdminControlPlaneService;
  browserAct: BrowserActControlService;
  requestCode: string;
  requesterUserId: string;
  requesterOpenId?: string;
  actorId?: string;
}): Promise<string> {
  const { service, browserAct, requestCode, requesterUserId, requesterOpenId, actorId = 'feishu-login' } = options;
  const request = getLoginRequest(service, requestCode, requesterUserId, requesterOpenId);
  if (request.status === 'expired') throw new Error('登录请求已过期，请重新发起 /login');
  if (!request.browserActBrowserId) throw new Error('登录请求还没有绑定 browser-act 浏览器');

  const verification = await browserAct.verifyLogin({
    sessionName: request.sessionName,
    platform: request.platform,
  });
  if (!verification.healthy) {
    const reason = verification.reason || '未确认登录成功';
    service.markBrowserLoginRequestFailed(request.id, reason, actorId);
    throw new Error(`${reason}。请确认远程协助页面已进入商家后台后重新发起登录。`);
  }

  const store = service.listStores().find((item) => item.id === request.storeId);
  const policy = riskForLoginRequest(service, request);
  const profile = service.upsertBrowserProfileFromBrowserAct({
    platform: request.platform,
    label: `${store?.name || request.storeId}${request.platform}登录态`,
    storeId: request.storeId,
    browserActBrowserId: request.browserActBrowserId,
    riskLevel: policy.riskLevel,
    allowedActionLevel: policy.allowedActionLevel,
    lastSuccessfulUseAt: Date.now(),
  }, actorId);
  service.markBrowserLoginRequestHealthy(request.id, profile.id, actorId);
  return `登录态已登记：${profile.label}。后台只保存 browser-act 引用，不保存 cookie、密码或验证码。`;
}

export function cancelBrowserActLoginRequest(options: {
  service: AdminControlPlaneService;
  requestCode: string;
  requesterUserId: string;
  requesterOpenId?: string;
  actorId?: string;
}): string {
  const { service, requestCode, requesterUserId, requesterOpenId, actorId = 'feishu-login' } = options;
  const request = getLoginRequest(service, requestCode, requesterUserId, requesterOpenId);
  service.markBrowserLoginRequestCancelled(request.id, actorId);
  return `已取消登录请求：${requestCode}`;
}

export function getBrowserActLoginStatus(options: {
  service: AdminControlPlaneService;
  requestCode: string;
  requesterUserId: string;
  requesterOpenId?: string;
}): string {
  const { service, requestCode, requesterUserId, requesterOpenId } = options;
  const request = getLoginRequest(service, requestCode, requesterUserId, requesterOpenId);
  return `登录请求 ${requestCode} 当前状态：${request.status}，过期时间：${new Date(request.expiresAt).toLocaleString()}`;
}

function getLoginRequest(
  service: AdminControlPlaneService,
  requestCode: string,
  requesterUserId?: string,
  requesterOpenId?: string,
): BrowserLoginRequest {
  const request = service.listBrowserLoginRequests().find((item) => item.id === requestCode);
  if (!request) throw new Error(`未找到登录请求：${requestCode}`);
  if (requesterUserId && request.requesterUserId !== requesterUserId && request.requesterOpenId !== requesterOpenId) {
    throw new Error('只能处理你本人发起的登录请求');
  }
  return request;
}

function riskForLoginRequest(
  service: AdminControlPlaneService,
  request: BrowserLoginRequest,
): { riskLevel: RiskLevel; allowedActionLevel: BrowserActionLevel } {
  const account = request.platformAccountId
    ? service.listPlatformAccounts().find((item) => item.id === request.platformAccountId)
    : undefined;
  if (account?.riskAccountClass === 'critical') return { riskLevel: 'critical', allowedActionLevel: 'destructive' };
  if (account?.riskAccountClass === 'high_risk') return { riskLevel: 'high', allowedActionLevel: 'high_risk_write' };
  if (account?.riskAccountClass === 'sensitive') return { riskLevel: 'medium', allowedActionLevel: 'read_only' };
  return { riskLevel: 'medium', allowedActionLevel: 'read_only' };
}
