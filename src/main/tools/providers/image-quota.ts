/**
 * 图片生成配额管理
 * 
 * API Key 格式：<actual-key>-<35位加密配额>
 * 结构：30位数据（10个数字×3字符）+ 2位日期校验 + 3位随机盐 = 35位
 * 包含：数量（0-9999，0=无限制）+ 到期日期（YYMMDD，000000=永不过期）
 * 每次生成密钥都不同（末尾随机盐），验证时 3 天窗口（天级）
 */

import type { SystemConfigStore } from '../../database/system-config-store';

// 加密参数（与生成脚本一致）
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const CHARSET_LEN = CHARSET.length;
const SEEDS = [
  [7, 13, 29],
  [3, 17, 37],
  [9, 23, 41],
  [2, 19, 43],
  [5, 11, 31],
  [8, 27, 47],
  [4, 14, 33],
  [6, 21, 39],
  [1, 16, 44],
  [10, 25, 46],
];

/**
 * 配额信息
 */
export interface ImageQuota {
  totalAllowed: number;
  expiryDate: string;      // YYYY-MM-DD 格式，空字符串表示永不过期
  used: number;
  expired: boolean;
  exhausted: boolean;
  unlimited: boolean;
}

/**
 * 获取天级日期种子
 */
function getDaySeed(date: Date): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;
  let sum = 0;
  for (const c of dateStr) {
    sum += parseInt(c, 10);
  }
  return sum;
}

/**
 * 将盐转换为数字
 */
function saltToNumber(salt: string): number {
  let total = 0;
  for (let i = 0; i < salt.length; i++) {
    total += CHARSET.indexOf(salt[i]) * (i + 1);
  }
  return total;
}

/**
 * 用指定天级种子解密 35 位字符串
 */
function decodeWithSeed(encoded: string, daySeed: number): { quantity: number; expiryYear: number; expiryMonth: number; expiryDay: number } | null {
  if (encoded.length !== 35) return null;

  // 验证日期校验码（第 30-31 位）
  const check1 = (daySeed * 7 + 13) % CHARSET_LEN;
  const check2 = (daySeed * 11 + 29) % CHARSET_LEN;
  const idx30 = CHARSET.indexOf(encoded[30]);
  const idx31 = CHARSET.indexOf(encoded[31]);
  if (idx30 === -1 || idx31 === -1) return null;
  if (idx30 !== check1 || idx31 !== check2) return null;

  // 提取盐（最后 3 位）
  const salt = encoded.substring(32, 35);
  const saltNum = saltToNumber(salt);

  // 解密前 30 位（每 3 字符 = 1 个数字，共 10 个数字）
  const digits: number[] = [];
  for (let i = 0; i < 10; i++) {
    const candidates: number[] = [];
    for (let j = 0; j < 3; j++) {
      const charIndex = CHARSET.indexOf(encoded[i * 3 + j]);
      if (charIndex === -1) return null;

      let foundD: number | null = null;
      for (let d = 0; d <= 9; d++) {
        if ((d * (j + 3) + SEEDS[i][j] + i * 7 + j * 11 + daySeed + saltNum) % CHARSET_LEN === charIndex) {
          foundD = d;
          break;
        }
      }
      if (foundD === null) return null;
      candidates.push(foundD);
    }

    if (candidates[0] !== candidates[1] || candidates[1] !== candidates[2]) return null;
    digits.push(candidates[0]);
  }

  const quantity = digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3];
  const expiryYear = digits[4] * 10 + digits[5];
  const expiryMonth = digits[6] * 10 + digits[7];
  const expiryDay = digits[8] * 10 + digits[9];

  return { quantity, expiryYear, expiryMonth, expiryDay };
}

/**
 * 解密配额字符串（尝试 3 天窗口）
 */
function decodeQuota(encoded: string): { quantity: number; expiryYear: number; expiryMonth: number; expiryDay: number } | null {
  const now = new Date();
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const seed = getDaySeed(date);
    const result = decodeWithSeed(encoded, seed);
    if (result) return result;
  }
  return null;
}

/**
 * 从 API Key 中解析配额后缀
 * 首次解密成功后缓存，后续不再校验日期
 */
export function parseApiKeyQuota(apiKey: string, configStore?: SystemConfigStore): { actualKey: string; totalAllowed: number; expiryDate: string } | null {
  if (!apiKey || apiKey.length < 37) return null;

  const lastDash = apiKey.lastIndexOf('-');
  if (lastDash === -1 || lastDash === apiKey.length - 1) return null;

  const suffix = apiKey.substring(lastDash + 1);
  if (suffix.length !== 35) return null;

  // 先检查缓存
  if (configStore) {
    const cached = configStore.getAppSetting('image_quota_cached_suffix');
    const cachedData = configStore.getAppSetting('image_quota_cached_data');
    if (cached === suffix && cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        if (parsed.quantity !== undefined && parsed.expiryDate !== undefined) {
          return {
            actualKey: apiKey.substring(0, lastDash),
            totalAllowed: parsed.quantity,
            expiryDate: parsed.expiryDate,
          };
        }
      } catch { /* 缓存损坏，重新解密 */ }
    }
  }

  // 尝试解密（3 天窗口）
  const decoded = decodeQuota(suffix);
  if (!decoded) return null;
  if (decoded.quantity < 0 || decoded.quantity > 9999) return null;

  // 构建到期日期字符串
  let expiryDate = '';
  if (decoded.expiryYear !== 0 || decoded.expiryMonth !== 0 || decoded.expiryDay !== 0) {
    const fullYear = 2000 + decoded.expiryYear;
    expiryDate = `${fullYear}-${String(decoded.expiryMonth).padStart(2, '0')}-${String(decoded.expiryDay).padStart(2, '0')}`;
  }

  // 缓存结果
  if (configStore) {
    configStore.setAppSetting('image_quota_cached_suffix', suffix);
    configStore.setAppSetting('image_quota_cached_data', JSON.stringify({ quantity: decoded.quantity, expiryDate }));
  }

  return {
    actualKey: apiKey.substring(0, lastDash),
    totalAllowed: decoded.quantity,
    expiryDate,
  };
}

/**
 * 获取图片生成配额状态
 */
export function getImageQuotaStatus(configStore: SystemConfigStore): ImageQuota | null {
  const config = configStore.getImageGenerationToolConfig();
  if (!config || !config.apiKey) return null;

  const parsed = parseApiKeyQuota(config.apiKey, configStore);
  if (!parsed) return null;

  const unlimited = parsed.totalAllowed === 0;

  const usedStr = configStore.getAppSetting('image_quota_used') || '0';
  const quotaKeyStr = configStore.getAppSetting('image_quota_key') || '';

  let used = parseInt(usedStr, 10) || 0;

  // 用完整后缀作为 key，换新密钥时重置
  const suffix = config.apiKey.substring(config.apiKey.lastIndexOf('-') + 1);
  if (quotaKeyStr !== suffix) {
    used = 0;
    configStore.setAppSetting('image_quota_used', '0');
    configStore.setAppSetting('image_quota_key', suffix);
  }

  // 检查是否过期
  let expired = false;
  if (parsed.expiryDate) {
    const expiry = new Date(parsed.expiryDate + 'T23:59:59');
    expired = Date.now() > expiry.getTime();
  }

  // 检查是否用完（0=无限制）
  const exhausted = !unlimited && used >= parsed.totalAllowed;

  return {
    totalAllowed: parsed.totalAllowed,
    expiryDate: parsed.expiryDate,
    used,
    expired,
    exhausted,
    unlimited,
  };
}

/**
 * 增加使用计数
 */
export function incrementImageQuotaUsed(configStore: SystemConfigStore): void {
  const usedStr = configStore.getAppSetting('image_quota_used') || '0';
  const used = (parseInt(usedStr, 10) || 0) + 1;
  configStore.setAppSetting('image_quota_used', String(used));
}

/**
 * 同步配额到服务器
 */
export async function syncImageQuotaToServer(configStore: SystemConfigStore): Promise<void> {
  try {
    const config = configStore.getImageGenerationToolConfig();
    if (!config || !config.apiKey) return;

    const parsed = parseApiKeyQuota(config.apiKey, configStore);
    if (!parsed) return;

    const usedStr = configStore.getAppSetting('image_quota_used') || '0';
    const used = parseInt(usedStr, 10) || 0;

    const baseUrl = config.apiUrl.replace(/\/tool\/.*$/, '').replace(/\/v[12]\/?$/, '');
    const syncUrl = `${baseUrl}/quota/sync`;

    const quotaKey = config.apiKey.substring(config.apiKey.lastIndexOf('-') + 1);

    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: quotaKey, used }),
    });

    if (response.ok) {
      const data: any = await response.json();
      if (typeof data.used === 'number' && data.used !== used) {
        configStore.setAppSetting('image_quota_used', String(data.used));
        console.log(`[Image Quota] 同步配额：本地 ${used} → 服务器 ${data.used}`);
      }
    }
  } catch (error) {
    console.warn('[Image Quota] 配额同步失败（不影响使用）:', error);
  }
}

/**
 * 检查是否可以生成图片
 */
export function checkImageQuota(configStore: SystemConfigStore): string | null {
  const config = configStore.getImageGenerationToolConfig();
  if (!config || !config.apiKey) return '图片生成工具未配置 API Key';

  const parsed = parseApiKeyQuota(config.apiKey, configStore);
  if (!parsed) return '图片生成 API Key 无效，请检查是否正确';

  const quota = getImageQuotaStatus(configStore);
  if (!quota) return '无法获取配额状态';

  if (quota.expired) {
    return `图片生成配额已过期（到期日期 ${quota.expiryDate}）。请联系管理员续期。`;
  }

  if (quota.exhausted) {
    return `图片生成配额已用完（${quota.used}/${quota.totalAllowed} 张）。请联系管理员增加配额。`;
  }

  return null;
}
