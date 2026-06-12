/**
 * 门店管理工具
 *
 * 提供门店的 CRUD 操作，包括：
 * - 创建门店
 * - 更新门店
 * - 删除门店
 * - 查询门店
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { createLogger } from '../../../shared/utils/logger';
import type { AdminStore, CreateStoreInput } from '../../../types/admin-control-plane';
import { SystemConfigStore } from '../../infrastructure/database/system-config-store';

const logger = createLogger('StoreManagementTool');

/** 统一错误返回 */
function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

// ==================== 工具插件 ====================

export const storeManagementToolPlugin: ToolPlugin = {
  metadata: {
    id: 'store-management',
    name: '门店管理',
    description: '管理门店信息，包括创建、更新、删除和查询',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['store', 'management'],
  },

  create(options: ToolCreateOptions) {
    // ========== 创建门店 ==========
    const createStoreTool: AgentTool = {
      name: 'store_create',
      label: '创建门店',
      description: '创建新门店。需要提供门店名称，其他信息可选。',
      parameters: Type.Object({
        name: Type.String({
          description: '门店名称，如"趣东北·东北小馆(石岩店)"',
        }),
        brand: Type.Optional(Type.String({
          description: '品牌名称，如"趣东北"',
        })),
        city: Type.Optional(Type.String({
          description: '城市，如"深圳"',
        })),
        area: Type.Optional(Type.String({
          description: '区域，如"石岩"',
        })),
        aliases: Type.Optional(Type.Array(Type.String(), {
          description: '门店别名，如["趣东北", "东北小馆"]',
        })),
        notes: Type.Optional(Type.String({
          description: '备注信息',
        })),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { name, brand, city, area, aliases, notes } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          const timestamp = Date.now();
          const id = `store_${timestamp.toString(36)}_${Math.random().toString(36).substr(2, 9)}`;

          dbInstance.prepare(`
            INSERT INTO stores (id, name, brand, city, area, aliases, status, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            name.trim(),
            brand || null,
            city || null,
            area || null,
            JSON.stringify(aliases || []),
            'operating',
            notes || null,
            timestamp,
            timestamp
          );

          logger.info(`创建门店成功: ${id}, 名称: ${name}`);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 创建成功\n门店ID: ${id}\n门店名称: ${name}`,
            }],
            details: {
              success: true,
              store: {
                id,
                name,
                brand,
                city,
                area,
                aliases: aliases || [],
                status: 'operating',
                notes,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            },
          };
        } catch (error) {
          logger.error('创建门店失败:', error);
          return errResult('创建门店失败', error);
        }
      },
    };

    // ========== 更新门店 ==========
    const updateStoreTool: AgentTool = {
      name: 'store_update',
      label: '更新门店',
      description: '更新门店信息。需要提供门店ID，其他信息可选。',
      parameters: Type.Object({
        store_id: Type.String({
          description: '门店ID',
        }),
        name: Type.Optional(Type.String({
          description: '门店名称',
        })),
        brand: Type.Optional(Type.String({
          description: '品牌名称',
        })),
        city: Type.Optional(Type.String({
          description: '城市',
        })),
        area: Type.Optional(Type.String({
          description: '区域',
        })),
        aliases: Type.Optional(Type.Array(Type.String(), {
          description: '门店别名',
        })),
        notes: Type.Optional(Type.String({
          description: '备注信息',
        })),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { store_id, name, brand, city, area, aliases, notes } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          // 查询现有门店
          const existing = dbInstance.prepare(`
            SELECT * FROM stores WHERE id = ?
          `).get(store_id) as any;

          if (!existing) {
            return errResult('门店不存在', new Error(`门店不存在: ${store_id}`));
          }

          const timestamp = Date.now();
          const updatedName = name || existing.name;
          const updatedBrand = brand !== undefined ? brand : existing.brand;
          const updatedCity = city !== undefined ? city : existing.city;
          const updatedArea = area !== undefined ? area : existing.area;
          const updatedAliases = aliases !== undefined ? aliases : JSON.parse(existing.aliases || '[]');
          const updatedNotes = notes !== undefined ? notes : existing.notes;

          dbInstance.prepare(`
            UPDATE stores
            SET name = ?, brand = ?, city = ?, area = ?, aliases = ?, notes = ?, updated_at = ?
            WHERE id = ?
          `).run(
            updatedName,
            updatedBrand,
            updatedCity,
            updatedArea,
            JSON.stringify(updatedAliases),
            updatedNotes,
            timestamp,
            store_id
          );

          logger.info(`更新门店成功: ${store_id}`);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 更新成功\n门店ID: ${store_id}\n门店名称: ${updatedName}`,
            }],
            details: {
              success: true,
              store: {
                id: store_id,
                name: updatedName,
                brand: updatedBrand,
                city: updatedCity,
                area: updatedArea,
                aliases: updatedAliases,
                notes: updatedNotes,
                updatedAt: timestamp,
              },
            },
          };
        } catch (error) {
          logger.error('更新门店失败:', error);
          return errResult('更新门店失败', error);
        }
      },
    };

    // ========== 删除门店 ==========
    const deleteStoreTool: AgentTool = {
      name: 'store_delete',
      label: '删除门店',
      description: '删除门店。同时会删除关联的平台登录态。',
      parameters: Type.Object({
        store_id: Type.String({
          description: '门店ID',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { store_id } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          // 查询现有门店
          const existing = dbInstance.prepare(`
            SELECT * FROM stores WHERE id = ?
          `).get(store_id) as any;

          if (!existing) {
            return errResult('门店不存在', new Error(`门店不存在: ${store_id}`));
          }

          // 删除关联的平台登录态
          dbInstance.prepare(`
            DELETE FROM platform_accounts WHERE store_id = ?
          `).run(store_id);

          // 删除门店
          dbInstance.prepare(`
            DELETE FROM stores WHERE id = ?
          `).run(store_id);

          logger.info(`删除门店成功: ${store_id}`);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 删除成功\n门店ID: ${store_id}\n门店名称: ${existing.name}`,
            }],
            details: {
              success: true,
            },
          };
        } catch (error) {
          logger.error('删除门店失败:', error);
          return errResult('删除门店失败', error);
        }
      },
    };

    // ========== 查询门店列表 ==========
    const listStoresTool: AgentTool = {
      name: 'store_list',
      label: '查询门店列表',
      description: '查询所有门店列表。支持按名称搜索。',
      parameters: Type.Object({
        search: Type.Optional(Type.String({
          description: '搜索关键词（可选，按名称或别名搜索）',
        })),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { search } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          let query = `
            SELECT * FROM stores WHERE status = 'operating'
          `;
          const params: any[] = [];

          if (search) {
            query += ` AND (name LIKE ? OR aliases LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
          }

          query += ` ORDER BY name`;

          const rows = dbInstance.prepare(query).all(...params) as any[];

          const stores = rows.map(row => ({
            id: row.id,
            name: row.name,
            brand: row.brand || undefined,
            city: row.city || undefined,
            area: row.area || undefined,
            aliases: JSON.parse(row.aliases || '[]'),
            notes: row.notes || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 查询成功\n门店数量: ${stores.length}\n\n${stores.map(s => `- ${s.name}`).join('\n')}`,
            }],
            details: {
              success: true,
              stores,
            },
          };
        } catch (error) {
          logger.error('查询门店列表失败:', error);
          return errResult('查询门店列表失败', error);
        }
      },
    };

    // ========== 查询门店详情 ==========
    const getStoreTool: AgentTool = {
      name: 'store_get',
      label: '查询门店详情',
      description: '查询指定门店的详细信息。',
      parameters: Type.Object({
        store_id: Type.String({
          description: '门店ID',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { store_id } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          const row = dbInstance.prepare(`
            SELECT * FROM stores WHERE id = ?
          `).get(store_id) as any;

          if (!row) {
            return errResult('门店不存在', new Error(`门店不存在: ${store_id}`));
          }

          // 查询关联的平台登录态
          const sessions = dbInstance.prepare(`
            SELECT * FROM platform_accounts WHERE store_id = ? AND status = 'active'
          `).all(store_id) as any[];

          const store = {
            id: row.id,
            name: row.name,
            brand: row.brand || undefined,
            city: row.city || undefined,
            area: row.area || undefined,
            aliases: JSON.parse(row.aliases || '[]'),
            notes: row.notes || undefined,
            platforms: sessions.map(s => ({
              id: s.id,
              platform: s.platform,
              label: s.label,
              status: s.status,
              lastUsedAt: s.last_used_at,
            })),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 查询成功\n门店名称: ${store.name}\n品牌: ${store.brand || '-'}\n城市: ${store.city || '-'}\n区域: ${store.area || '-'}\n别名: ${store.aliases.join(', ') || '-'}\n平台: ${store.platforms.map(p => p.platform).join(', ') || '无'}`,
            }],
            details: {
              success: true,
              store,
            },
          };
        } catch (error) {
          logger.error('查询门店详情失败:', error);
          return errResult('查询门店详情失败', error);
        }
      },
    };

    return [createStoreTool, updateStoreTool, deleteStoreTool, listStoresTool, getStoreTool];
  },
};
