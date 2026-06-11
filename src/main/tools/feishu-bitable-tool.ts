/**
 * 飞书多维表格工具
 *
 * 提供飞书多维表格（Bitable）的 CRUD 操作，用于：
 * - 存储和管理门店经营数据
 * - 查询历史数据进行对比分析
 * - 更新门店信息和运营记录
 *
 * 依赖飞书连接器配置中的 appId / appSecret
 *
 * 注意：当前版本使用配置文件管理门店-表格映射关系，
 * 后续版本将迁移到数据库存储
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { TOOL_NAMES } from './tool-names';
import { createLogger } from '../../shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('FeishuBitableTool');

// 全局 configStore 引用
let configStoreInstance: any = null;

// 缓存的 lark Client 实例
let cachedClient: any = null;
let cachedClientKey: string = '';

/**
 * 注入 configStore（由 gateway.ts 调用）
 */
export function setConfigStoreForFeishuBitableTool(store: any): void {
  configStoreInstance = store;
  cachedClient = null;
  cachedClientKey = '';
}

/**
 * 获取飞书 lark Client（带缓存）
 */
async function getLarkClient(): Promise<any> {
  if (!configStoreInstance) {
    throw new Error('configStore 未初始化，请确保飞书连接器已配置');
  }

  const connectorConfig = configStoreInstance.getConnectorConfig('feishu');
  if (!connectorConfig?.config?.appId || !connectorConfig?.config?.appSecret) {
    throw new Error('飞书连接器未配置，请先在系统设置中配置飞书连接器的 appId 和 appSecret');
  }

  const clientKey = `${connectorConfig.config.appId}:${connectorConfig.config.appSecret}`;
  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  const lark = require('@larksuiteoapi/node-sdk');
  cachedClient = new lark.Client({
    appId: connectorConfig.config.appId,
    appSecret: connectorConfig.config.appSecret,
    disableTokenCache: false,
  });
  cachedClientKey = clientKey;
  return cachedClient;
}

/**
 * 获取门店配置文件路径
 */
function getStoresConfigPath(): string {
  const workspaceDir = configStoreInstance?.getWorkspaceSettings()?.workspaceDir || process.cwd();
  return path.join(workspaceDir, '.deepbot', 'stores-config.json');
}

/**
 * 读取门店配置
 */
function loadStoresConfig(): Record<string, any> {
  const configPath = getStoresConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * 保存门店配置
 */
function saveStoresConfig(config: Record<string, any>): void {
  const configPath = getStoresConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** 统一错误返回 */
function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

// ==================== 工具插件 ====================

export const feishuBitableToolPlugin: ToolPlugin = {
  metadata: {
    id: 'feishu-bitable',
    name: '飞书多维表格',
    description: '操作飞书多维表格（Bitable），支持门店数据存储、查询和更新',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['feishu', 'bitable', 'database'],
  },

  create(options: ToolCreateOptions) {
    if (options.configStore) {
      setConfigStoreForFeishuBitableTool(options.configStore);
    }

    // ========== 查询记录 ==========
    const listRecordsTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_BITABLE_LIST_RECORDS,
      label: '查询多维表格记录',
      description: '查询飞书多维表格中的记录。可用于获取门店历史经营数据、筛选特定条件的记录等。',
      parameters: Type.Object({
        app_token: Type.String({
          description: '多维表格 app_token（从表格 URL 中获取）',
        }),
        table_id: Type.String({
          description: '数据表 ID',
        }),
        filter: Type.Optional(
          Type.String({
            description: '筛选条件（飞书筛选语法），如 "CurrentValue.[门店]=\\"趣东北\\""',
          })
        ),
        sort: Type.Optional(
          Type.Array(
            Type.Object({
              field_name: Type.String(),
              desc: Type.Optional(Type.Boolean()),
            }),
            { description: '排序条件' }
          )
        ),
        page_size: Type.Optional(
          Type.Number({
            description: '每页记录数，默认 20，最大 500',
            default: 20,
          })
        ),
        page_token: Type.Optional(
          Type.String({
            description: '分页标记，用于获取下一页数据',
          })
        ),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { app_token, table_id, filter, sort, page_size = 20, page_token } = args;

        try {
          const client = await getLarkClient();

          const queryParams: any = {
            page_size: Math.min(page_size, 500),
          };

          if (filter) {
            queryParams.filter = filter;
          }
          if (sort) {
            queryParams.sort = JSON.stringify(sort);
          }
          if (page_token) {
            queryParams.page_token = page_token;
          }

          const response = await client.bitable.v1.appTableRecord.list({
            path: { app_token, table_id },
            params: queryParams,
          });

          const data = (response as any)?.data;
          const records = data?.items || [];
          const total = data?.total || 0;
          const hasMore = data?.has_more || false;
          const nextPageToken = data?.page_token;

          // 格式化记录
          const formattedRecords = records.map((record: any) => ({
            record_id: record.record_id,
            fields: record.fields,
          }));

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 查询成功\n共 ${total} 条记录，当前返回 ${formattedRecords.length} 条${hasMore ? '\n还有更多数据，使用 page_token 获取下一页' : ''}`,
            }],
            details: {
              success: true,
              total,
              records: formattedRecords,
              hasMore,
              pageToken: nextPageToken,
            },
          };
        } catch (error) {
          logger.error('查询多维表格失败:', error);
          return errResult('查询多维表格失败', error);
        }
      },
    };

    // ========== 创建记录 ==========
    const createRecordTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_BITABLE_CREATE_RECORD,
      label: '创建多维表格记录',
      description: '向飞书多维表格插入新记录。用于保存采集到的经营数据、新增门店信息等。',
      parameters: Type.Object({
        app_token: Type.String({
          description: '多维表格 app_token',
        }),
        table_id: Type.String({
          description: '数据表 ID',
        }),
        fields: Type.Record(Type.String(), Type.Any(), {
          description: '记录字段，如 {"门店": "趣东北", "营业额": 3580, "日期": "2024-01-15"}',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { app_token, table_id, fields } = args;

        try {
          const client = await getLarkClient();

          const response = await client.bitable.v1.appTableRecord.create({
            path: { app_token, table_id },
            data: { fields },
          });

          const record = (response as any)?.data?.record;

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 记录创建成功\n记录 ID: ${record?.record_id}`,
            }],
            details: {
              success: true,
              recordId: record?.record_id,
              fields: record?.fields,
            },
          };
        } catch (error) {
          logger.error('创建记录失败:', error);
          return errResult('创建记录失败', error);
        }
      },
    };

    // ========== 批量创建记录 ==========
    const batchCreateRecordsTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_BITABLE_BATCH_CREATE,
      label: '批量创建多维表格记录',
      description: '批量向飞书多维表格插入多条记录。用于批量导入历史经营数据。',
      parameters: Type.Object({
        app_token: Type.String({
          description: '多维表格 app_token',
        }),
        table_id: Type.String({
          description: '数据表 ID',
        }),
        records: Type.Array(
          Type.Record(Type.String(), Type.Any()),
          {
            description: '记录数组，每条记录包含 fields 字段',
          }
        ),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { app_token, table_id, records } = args;

        try {
          const client = await getLarkClient();

          const response = await client.bitable.v1.appTableRecord.batchCreate({
            path: { app_token, table_id },
            data: {
              records: records.map((fields: Record<string, any>) => ({ fields })),
            },
          });

          const createdRecords = (response as any)?.data?.records || [];

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 批量创建成功\n共创建 ${createdRecords.length} 条记录`,
            }],
            details: {
              success: true,
              count: createdRecords.length,
              records: createdRecords.map((r: any) => ({
                record_id: r.record_id,
                fields: r.fields,
              })),
            },
          };
        } catch (error) {
          logger.error('批量创建记录失败:', error);
          return errResult('批量创建记录失败', error);
        }
      },
    };

    // ========== 更新记录 ==========
    const updateRecordTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_BITABLE_UPDATE_RECORD,
      label: '更新多维表格记录',
      description: '更新飞书多维表格中的指定记录。用于修正数据、更新门店信息等。',
      parameters: Type.Object({
        app_token: Type.String({
          description: '多维表格 app_token',
        }),
        table_id: Type.String({
          description: '数据表 ID',
        }),
        record_id: Type.String({
          description: '要更新的记录 ID',
        }),
        fields: Type.Record(Type.String(), Type.Any(), {
          description: '要更新的字段',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { app_token, table_id, record_id, fields } = args;

        try {
          const client = await getLarkClient();

          const response = await client.bitable.v1.appTableRecord.update({
            path: { app_token, table_id, record_id },
            data: { fields },
          });

          const record = (response as any)?.data?.record;

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 记录更新成功\n记录 ID: ${record_id}`,
            }],
            details: {
              success: true,
              recordId: record_id,
              fields: record?.fields,
            },
          };
        } catch (error) {
          logger.error('更新记录失败:', error);
          return errResult('更新记录失败', error);
        }
      },
    };

    // ========== 门店配置管理 ==========
    const manageStoreConfigTool: AgentTool = {
      name: TOOL_NAMES.FEISHU_STORE_CONFIG,
      label: '管理门店配置',
      description: '管理门店配置信息，包括门店与飞书群、负责人、多维表格的映射关系。',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('get'),
          Type.Literal('set'),
          Type.Literal('list'),
          Type.Literal('delete'),
        ], {
          description: '操作类型：get（获取）、set（设置）、list（列表）、delete（删除）',
        }),
        store_id: Type.Optional(
          Type.String({
            description: '门店 ID（get/set/delete 时必填）',
          })
        ),
        config: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: '门店配置（set 时必填），如 {"name": "趣东北", "chat_id": "oc_xxx", "manager": "张三", "app_token": "xxx", "table_id": "xxx"}',
          })
        ),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { action, store_id, config } = args;

        try {
          const storesConfig = loadStoresConfig();

          switch (action) {
            case 'get': {
              if (!store_id) {
                return errResult('参数错误', new Error('get 操作需要 store_id'));
              }
              const store = storesConfig[store_id];
              if (!store) {
                return {
                  content: [{ type: 'text' as const, text: `未找到门店配置: ${store_id}` }],
                  details: { success: false, found: false },
                };
              }
              return {
                content: [{ type: 'text' as const, text: `✅ 门店配置获取成功: ${store.name}` }],
                details: { success: true, store },
              };
            }

            case 'set': {
              if (!store_id || !config) {
                return errResult('参数错误', new Error('set 操作需要 store_id 和 config'));
              }
              storesConfig[store_id] = {
                ...config,
                store_id,
                updated_at: new Date().toISOString(),
              };
              saveStoresConfig(storesConfig);
              return {
                content: [{ type: 'text' as const, text: `✅ 门店配置已保存: ${config.name || store_id}` }],
                details: { success: true, storeId: store_id },
              };
            }

            case 'list': {
              const stores = Object.values(storesConfig);
              return {
                content: [{
                  type: 'text' as const,
                  text: `✅ 共 ${stores.length} 个门店配置`,
                }],
                details: { success: true, stores },
              };
            }

            case 'delete': {
              if (!store_id) {
                return errResult('参数错误', new Error('delete 操作需要 store_id'));
              }
              if (!storesConfig[store_id]) {
                return errResult('删除失败', new Error(`门店不存在: ${store_id}`));
              }
              const storeName = storesConfig[store_id].name;
              delete storesConfig[store_id];
              saveStoresConfig(storesConfig);
              return {
                content: [{ type: 'text' as const, text: `✅ 门店配置已删除: ${storeName}` }],
                details: { success: true, storeId: store_id },
              };
            }

            default:
              return errResult('参数错误', new Error(`未知操作: ${action}`));
          }
        } catch (error) {
          logger.error('管理门店配置失败:', error);
          return errResult('管理门店配置失败', error);
        }
      },
    };

    return [listRecordsTool, createRecordTool, batchCreateRecordsTool, updateRecordTool, manageStoreConfigTool];
  },
};
