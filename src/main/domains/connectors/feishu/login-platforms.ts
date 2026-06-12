import type { BrowserActBrowserSummary } from '../../browser-act/browser-act-parser';

export interface MerchantLoginPlatform {
  platform: 'meituan';
  displayName: string;
  loginUrl: string;
}

export function resolveMerchantLoginPlatform(platform: string): MerchantLoginPlatform {
  const normalized = platform.trim().toLowerCase();
  if (['美团', 'meituan', 'mt'].includes(normalized)) {
    return {
      platform: 'meituan',
      displayName: '美团',
      loginUrl: 'https://ecom.meituan.com/',
    };
  }
  throw new Error(`第一版远程协助登录暂不支持 ${platform}，请先使用美团平台`);
}

export function selectBrowserActBrowserForLogin(input: {
  platform: string;
  storeName: string;
  browsers: BrowserActBrowserSummary[];
}): BrowserActBrowserSummary {
  if (input.browsers.length === 0) {
    throw new Error('没有可用的 browser-act 浏览器，请先在后台创建或同步浏览器');
  }

  const platformTokens = getPlatformTokens(input.platform);
  const storeToken = input.storeName.trim().toLowerCase();
  const scored = input.browsers
    .map((browser) => {
      const text = `${browser.id} ${browser.name} ${browser.desc || ''}`.toLowerCase();
      const platformScore = platformTokens.some((token) => text.includes(token)) ? 2 : 0;
      const storeScore = storeToken && text.includes(storeToken) ? 3 : 0;
      return { browser, score: platformScore + storeScore };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    throw new Error('没有明确匹配当前平台或门店的 browser-act 浏览器，请先在后台绑定或更新浏览器描述');
  }

  return scored[0].browser;
}

function getPlatformTokens(platform: string): string[] {
  const normalized = platform.trim().toLowerCase();
  if (normalized === 'meituan' || normalized === '美团' || normalized === 'mt') {
    return ['meituan', '美团', 'mt'];
  }
  return [normalized];
}
