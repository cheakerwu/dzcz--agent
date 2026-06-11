export interface BrowserActLoginVerificationInput {
  url?: string;
  title?: string;
  text?: string;
}

export interface BrowserActLoginVerificationResult {
  healthy: boolean;
  evidence: string[];
  reason?: string;
}

export type BrowserActLoginVerifier = (
  input: BrowserActLoginVerificationInput,
) => BrowserActLoginVerificationResult;

function includesAny(haystack: string, needles: string[]): string[] {
  return needles.filter((needle) => haystack.includes(needle.toLowerCase()));
}

function normalizeInput(input: BrowserActLoginVerificationInput): string {
  return [input.url, input.title, input.text].filter(Boolean).join('\n').toLowerCase();
}

export function verifyMeituanMerchantLogin(
  input: BrowserActLoginVerificationInput,
): BrowserActLoginVerificationResult {
  const combined = normalizeInput(input);
  const evidence: string[] = [];

  const loginSignals = includesAny(combined, [
    '/login',
    '账号登录',
    '手机验证码登录',
    '请输入手机号',
    '请输入密码',
  ]);
  if (loginSignals.length > 0) {
    return {
      healthy: false,
      evidence: loginSignals.map((signal) => `登录页信号：${signal}`),
      reason: '仍在登录页，未确认进入美团商家后台',
    };
  }

  const backendSignals = includesAny(combined, [
    'ecom.meituan.com',
    '美团商家中心',
    '经营数据',
    '门店管理',
    '商品管理',
    '订单管理',
  ]);
  if (backendSignals.length >= 2) {
    evidence.push('美团商家后台信号已命中');
    evidence.push(...backendSignals.map((signal) => `页面信号：${signal}`));
    return { healthy: true, evidence };
  }

  return {
    healthy: false,
    evidence: backendSignals.map((signal) => `页面信号：${signal}`),
    reason: '未找到足够的美团商家后台登录成功信号',
  };
}

export function getLoginVerifier(platform: string): BrowserActLoginVerifier | undefined {
  const normalized = platform.trim().toLowerCase();
  if (['美团', 'meituan', 'mt'].includes(normalized)) return verifyMeituanMerchantLogin;
  return undefined;
}
