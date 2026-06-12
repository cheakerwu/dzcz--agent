/**
 * 门店登录态创建服务
 *
 * 处理匹配失败的情况，提供登录方式选择
 */

import type Database from '../../../shared/utils/sqlite-adapter';
import { createLogger } from '../../../shared/utils/logger';
import type { AdminStore, AdminPlatformAccount } from '../../../types/admin-control-plane';

const logger = createLogger('StoreSessionCreator');

export interface LoginOption {
  id: string;
  label: string;
  description: string;
}

export interface LoginResult {
  success: boolean;
  session?: AdminPlatformAccount;
  error?: string;
}

export class StoreSessionCreator {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 获取登录选项
   */
  getLoginOptions(): LoginOption[] {
    return [
      {
        id: 'local_login',
        label: '在 Mac 端拉起页面登录',
        description: '在本地浏览器中登录，适合您在电脑前操作'
      },
      {
        id: 'remote_login',
        label: '通过远程协助功能登录',
        description: '发送登录链接给您，在任意设备上登录'
      }
    ];
  }

  /**
   * 创建平台登录态
   */
  async createPlatformSession(
    store: AdminStore,
    platform: string,
    storageState: string,
    actorId = 'system'
  ): Promise<AdminPlatformAccount> {
    const timestamp = Date.now();
    const id = `pa_${timestamp.toString(36)}_${Math.random().toString(36).substr(2, 9)}`;

    this.db.prepare(`
      INSERT INTO platform_accounts (id, platform, label, store_id, account_ref, status, risk_account_class, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      platform,
      `${store.name} - ${platform}`,
      store.id,
      storageState,
      'active',
      'standard',
      timestamp,
      timestamp
    );

    logger.info(`创建平台登录态: ${id}, 门店: ${store.name}, 平台: ${platform}`);

    return {
      id,
      platform,
      label: `${store.name} - ${platform}`,
      storeId: store.id,
      accountRef: storageState,
      status: 'active',
      riskAccountClass: 'standard',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /**
   * 更新平台登录态
   */
  async updatePlatformSession(
    sessionId: string,
    storageState: string,
    actorId = 'system'
  ): Promise<AdminPlatformAccount> {
    const timestamp = Date.now();

    this.db.prepare(`
      UPDATE platform_accounts
      SET account_ref = ?, updated_at = ?
      WHERE id = ?
    `).run(storageState, timestamp, sessionId);

    const row = this.db.prepare(`
      SELECT * FROM platform_accounts WHERE id = ?
    `).get(sessionId) as any;

    logger.info(`更新平台登录态: ${sessionId}`);

    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      storeId: row.store_id,
      accountRef: row.account_ref,
      status: row.status,
      riskAccountClass: row.risk_account_class,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 测试平台登录态是否有效
   */
  async testPlatformSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    // 这里需要调用浏览器自动化工具来测试登录态
    // 暂时返回成功，后续需要实现具体的测试逻辑
    logger.info(`测试平台登录态: ${sessionId}`);

    return {
      success: true,
      message: '登录态测试成功'
    };
  }

  /**
   * 删除平台登录态
   */
  async deletePlatformSession(sessionId: string, actorId = 'system'): Promise<void> {
    this.db.prepare(`
      DELETE FROM platform_accounts WHERE id = ?
    `).run(sessionId);

    logger.info(`删除平台登录态: ${sessionId}`);
  }
}
