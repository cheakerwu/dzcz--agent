/**
 * 门店登录态工具
 *
 * 提供门店登录态管理功能，包括：
 * - 匹配门店登录态
 * - 创建门店登录态
 * - 更新门店登录态
 * - 测试门店登录态
 * - 删除门店登录态
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { createLogger } from '../../../shared/utils/logger';
import { StoreMatcher, StoreSessionCreator } from '../stores';
import type { ParsedTask, MatchResult, LoginOption } from '../stores';
import { SystemConfigStore } from '../../infrastructure/database/system-config-store';

const logger = createLogger('StoreSessionTool');

/** 统一错误返回 */
function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

// ==================== 工具插件 ====================

export const storeSessionToolPlugin: ToolPlugin = {
  metadata: {
    id: 'store-session',
    name: '门店登录态管理',
    description: '管理门店的平台登录态，支持匹配、创建、更新、测试和删除',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['store', 'session', 'browser'],
  },

  create(options: ToolCreateOptions) {
    // ========== 匹配门店登录态 ==========
    const matchSessionTool: AgentTool = {
      name: 'store_session_match',
      label: '匹配门店登录态',
      description: '根据用户消息匹配门店和平台登录态。如果没有找到登录态，会返回可用的登录选项。',
      parameters: Type.Object({
        user_message: Type.String({
          description: '用户消息，如"帮我看看趣东北的美团页面"',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { user_message } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const db = configStore.getDb();

          const matcher = new StoreMatcher(db);
          const parsedTask = await matcher.parseTask(user_message);
          const result = await matcher.matchSession(parsedTask);

          if (result.success) {
            return {
              content: [{
                type: 'text' as const,
                text: `✅ 匹配成功\n门店：${result.store?.name}\n平台：${result.sessions?.map(s => s.platform).join(', ')}`,
              }],
              details: {
                success: true,
                store: result.store,
                sessions: result.sessions,
              },
            };
          } else {
            // 匹配失败，返回登录选项
            const creator = new StoreSessionCreator(db);
            const loginOptions = creator.getLoginOptions();

            return {
              content: [{
                type: 'text' as const,
                text: `❌ 匹配失败：${result.error}\n\n是否要新建一个登录态？\n${loginOptions.map((opt, i) => `${i + 1}. ${opt.label} - ${opt.description}`).join('\n')}`,
              }],
              details: {
                success: false,
                error: result.error,
                store: result.store,
                loginOptions,
              },
            };
          }
        } catch (error) {
          logger.error('匹配门店登录态失败:', error);
          return errResult('匹配门店登录态失败', error);
        }
      },
    };

    // ========== 创建门店登录态 ==========
    const createSessionTool: AgentTool = {
      name: 'store_session_create',
      label: '创建门店登录态',
      description: '为门店创建平台登录态。需要提供门店ID、平台名称和登录态数据。',
      parameters: Type.Object({
        store_id: Type.String({
          description: '门店ID',
        }),
        platform: Type.String({
          description: '平台名称：meituan/eleme/jd',
        }),
        storage_state: Type.String({
          description: '浏览器登录态（JSON格式）',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { store_id, platform, storage_state } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const db = configStore.getDb();

          const creator = new StoreSessionCreator(db);

          // 获取门店信息
          const storeRow = db.prepare(`
            SELECT * FROM stores WHERE id = ?
          `).get(store_id) as any;

          if (!storeRow) {
            return errResult('门店不存在', new Error(`门店不存在: ${store_id}`));
          }

          const store = {
            id: storeRow.id,
            name: storeRow.name,
            brand: storeRow.brand || undefined,
            city: storeRow.city || undefined,
            area: storeRow.area || undefined,
            platformStoreId: storeRow.platform_store_id || undefined,
            aliases: JSON.parse(storeRow.aliases || '[]'),
            status: storeRow.status,
            notes: storeRow.notes || undefined,
            activeMemoryCount: 0,
            staleMemoryCount: 0,
            createdAt: storeRow.created_at,
            updatedAt: storeRow.updated_at,
          };

          const session = await creator.createPlatformSession(store, platform, storage_state);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 创建成功\n门店：${store.name}\n平台：${platform}\n登录态ID：${session.id}`,
            }],
            details: {
              success: true,
              session,
            },
          };
        } catch (error) {
          logger.error('创建门店登录态失败:', error);
          return errResult('创建门店登录态失败', error);
        }
      },
    };

    // ========== 更新门店登录态 ==========
    const updateSessionTool: AgentTool = {
      name: 'store_session_update',
      label: '更新门店登录态',
      description: '更新已有的门店登录态。',
      parameters: Type.Object({
        session_id: Type.String({
          description: '登录态ID',
        }),
        storage_state: Type.String({
          description: '新的浏览器登录态（JSON格式）',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { session_id, storage_state } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const db = configStore.getDb();

          const creator = new StoreSessionCreator(db);
          const session = await creator.updatePlatformSession(session_id, storage_state);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 更新成功\n登录态ID：${session.id}\n平台：${session.platform}`,
            }],
            details: {
              success: true,
              session,
            },
          };
        } catch (error) {
          logger.error('更新门店登录态失败:', error);
          return errResult('更新门店登录态失败', error);
        }
      },
    };

    // ========== 测试门店登录态 ==========
    const testSessionTool: AgentTool = {
      name: 'store_session_test',
      label: '测试门店登录态',
      description: '测试门店登录态是否有效。',
      parameters: Type.Object({
        session_id: Type.String({
          description: '登录态ID',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { session_id } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const db = configStore.getDb();

          const creator = new StoreSessionCreator(db);
          const result = await creator.testPlatformSession(session_id);

          return {
            content: [{
              type: 'text' as const,
              text: result.success ? `✅ 测试成功：${result.message}` : `❌ 测试失败：${result.message}`,
            }],
            details: {
              success: result.success,
              message: result.message,
            },
          };
        } catch (error) {
          logger.error('测试门店登录态失败:', error);
          return errResult('测试门店登录态失败', error);
        }
      },
    };

    // ========== 删除门店登录态 ==========
    const deleteSessionTool: AgentTool = {
      name: 'store_session_delete',
      label: '删除门店登录态',
      description: '删除门店登录态。',
      parameters: Type.Object({
        session_id: Type.String({
          description: '登录态ID',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { session_id } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const db = configStore.getDb();

          const creator = new StoreSessionCreator(db);
          await creator.deletePlatformSession(session_id);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 删除成功\n登录态ID：${session_id}`,
            }],
            details: {
              success: true,
            },
          };
        } catch (error) {
          logger.error('删除门店登录态失败:', error);
          return errResult('删除门店登录态失败', error);
        }
      },
    };

    return [matchSessionTool, createSessionTool, updateSessionTool, testSessionTool, deleteSessionTool];
  },
};
