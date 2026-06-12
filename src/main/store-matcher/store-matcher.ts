/**
 * 门店匹配服务
 *
 * 根据用户消息解析门店名称和平台，匹配到正确的登录态
 */

import type Database from '../../shared/utils/sqlite-adapter';
import { createLogger } from '../../shared/utils/logger';
import { safeJsonParse } from '../../shared/utils/json-utils';
import type { AdminStore, AdminPlatformAccount } from '../../types/admin-control-plane';

const logger = createLogger('StoreMatcher');

export interface ParsedTask {
  storeName?: string;
  platform?: string;
  action?: string;
  details?: string;
}

export interface MatchResult {
  success: boolean;
  store?: AdminStore;
  sessions?: AdminPlatformAccount[];
  error?: string;
}

export class StoreMatcher {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 解析用户消息，提取门店名称和平台
   */
  async parseTask(userMessage: string): Promise<ParsedTask> {
    // 使用简单的规则匹配，后续可以集成 LLM
    const task: ParsedTask = {};

    // 提取平台名称
    const platformPatterns = [
      { pattern: /美团|meituan/i, platform: 'meituan' },
      { pattern: /饿了么|eleme/i, platform: 'eleme' },
      { pattern: /京东|jd/i, platform: 'jd' },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userMessage)) {
        task.platform = platform;
        break;
      }
    }

    // 提取门店名称（简单规则：去掉平台名称和常见动词）
    let storeName = userMessage;
    if (task.platform) {
      storeName = storeName.replace(/美团|meituan|饿了么|eleme|京东|jd/gi, '').trim();
    }
    storeName = storeName.replace(/帮我|看看|查看|检查|打开|页面|的/g, '').trim();

    if (storeName.length > 0) {
      task.storeName = storeName;
    }

    // 提取操作类型
    if (/查看|看看|检查|打开/.test(userMessage)) {
      task.action = 'view';
    } else if (/修改|改|更新/.test(userMessage)) {
      task.action = 'modify';
    } else if (/截图/.test(userMessage)) {
      task.action = 'screenshot';
    }

    logger.info(`解析任务: ${JSON.stringify(task)}`);
    return task;
  }

  /**
   * 根据门店名称或别名查找门店
   */
  findStoreByName(name: string): AdminStore | null {
    // 1. 精确匹配
    let row = this.db.prepare(`
      SELECT * FROM stores WHERE name = ? AND status = 'operating'
    `).get(name) as any;

    if (row) {
      return this.mapStore(row);
    }

    // 2. 别名匹配
    const stores = this.db.prepare(`
      SELECT * FROM stores WHERE status = 'operating'
    `).all() as any[];

    for (const store of stores) {
      const aliases = safeJsonParse(store.aliases, []);
      if (aliases.some((alias: string) => alias === name || name.includes(alias) || alias.includes(name))) {
        return this.mapStore(store);
      }
    }

    // 3. 模糊匹配
    row = this.db.prepare(`
      SELECT * FROM stores WHERE name LIKE ? AND status = 'operating'
    `).get(`%${name}%`) as any;

    if (row) {
      return this.mapStore(row);
    }

    return null;
  }

  /**
   * 获取门店的平台登录态
   */
  getPlatformSessions(storeId: string): AdminPlatformAccount[] {
    const rows = this.db.prepare(`
      SELECT * FROM platform_accounts WHERE store_id = ? AND status = 'active'
    `).all(storeId) as any[];

    return rows.map(row => ({
      id: row.id,
      platform: row.platform,
      label: row.label,
      storeId: row.store_id,
      accountRef: row.account_ref,
      status: row.status,
      riskAccountClass: row.risk_account_class,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * 匹配登录态
   */
  async matchSession(parsedTask: ParsedTask): Promise<MatchResult> {
    // 1. 查询门店
    if (!parsedTask.storeName) {
      return { success: false, error: '未识别到门店名称' };
    }

    const store = this.findStoreByName(parsedTask.storeName);
    if (!store) {
      return { success: false, error: `未找到门店: ${parsedTask.storeName}` };
    }

    // 2. 查询可用登录态
    const sessions = this.getPlatformSessions(store.id);
    if (sessions.length === 0) {
      return { success: false, store, error: `未找到'${store.name}'的登录态` };
    }

    // 3. 匹配平台
    if (parsedTask.platform) {
      const matchedSession = sessions.find(s => s.platform === parsedTask.platform);
      if (!matchedSession) {
        return {
          success: false,
          store,
          sessions,
          error: `未找到'${store.name}'的${parsedTask.platform}登录态`
        };
      }
      return { success: true, store, sessions: [matchedSession] };
    }

    // 4. 返回所有可用登录态（让用户选择）
    return { success: true, store, sessions };
  }

  /**
   * 映射数据库行到 AdminStore 对象
   */
  private mapStore(row: any): AdminStore {
    return {
      id: row.id,
      name: row.name,
      brand: row.brand || undefined,
      city: row.city || undefined,
      area: row.area || undefined,
      platformStoreId: row.platform_store_id || undefined,
      aliases: safeJsonParse(row.aliases, []),
      status: row.status,
      notes: row.notes || undefined,
      activeMemoryCount: 0,
      staleMemoryCount: 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
